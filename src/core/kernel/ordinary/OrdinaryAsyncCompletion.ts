import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { Pag, PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt, ArkReturnStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { ArkInstanceFieldRef, ArkParameterRef, ClosureFieldRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { ArkMethod } from "../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { fromContainerFieldKey } from "../model/ContainerSlotKeys";
import {
    detectDeferredCompletionKind,
    resolveDeferredCompletionCallbackArgIndexes,
    shouldPassthroughDeferredCompletion,
    type DeferredCompletionContinuationKind as PromiseContinuationKind,
    type DeferredCompletionSettlementHint as PromiseSettlementHint,
} from "../model/DeferredCompletionSemantics";
import { TaintFact } from "../model/TaintFact";
import { safeGetOrCreatePagNodes } from "../contracts/PagNodeResolution";
import { resolveCallbackMethodsFromValueWithReturns } from "../../substrate/queries/CallbackBindingQuery";

export function shouldPropagateOrdinaryAsyncCallbacks(fieldPath?: string[]): boolean {
    return !fieldPath
        || fieldPath.length === 0
        || fromContainerFieldKey(fieldPath[0]) !== null;
}

export function collectOrdinaryPromiseCallbackFactsFromTaintedReceiver(
    scene: Scene,
    pag: Pag,
    receiverLocal: Local,
    source: string,
    currentCtx: number,
    fieldPath?: string[],
): TaintFact[] {
    return collectPromiseCallbackFactsByReceiverLocal(
        scene,
        pag,
        receiverLocal,
        source,
        currentCtx,
        fieldPath,
        resolvePromiseSettlementHintForReceiverLocal(receiverLocal),
    );
}

export function collectOrdinaryPromiseCallbackFactsFromTaintedArg(
    scene: Scene,
    pag: Pag,
    taintedLocal: Local,
    source: string,
    currentCtx: number,
    fieldPath?: string[],
): TaintFact[] {
    const results: TaintFact[] = [];
    for (const stmt of taintedLocal.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const rightOp = stmt.getRightOp();
        if (!(rightOp instanceof ArkStaticInvokeExpr) && !(rightOp instanceof ArkInstanceInvokeExpr)) continue;

        const args = rightOp.getArgs ? rightOp.getArgs() : [];
        if (!args.includes(taintedLocal)) continue;

        const leftOp = stmt.getLeftOp();
        if (!(leftOp instanceof Local)) continue;
        results.push(...collectPromiseCallbackFactsByReceiverLocal(
            scene,
            pag,
            leftOp,
            source,
            currentCtx,
            fieldPath,
            resolvePromiseSettlementHintFromInvoke(rightOp),
        ));
    }
    return results;
}

export function collectOrdinaryPromiseFinallyCaptureFactsFromTaintedLocal(
    scene: Scene,
    pag: Pag,
    taintedLocal: Local,
    source: string,
    currentCtx: number,
    fieldPath?: string[],
): TaintFact[] {
    const declaringStmt = taintedLocal.getDeclaringStmt?.();
    const callerMethod = declaringStmt?.getCfg?.()?.getDeclaringMethod?.();
    const cfg = callerMethod?.getCfg?.();
    if (!cfg) return [];

    const results: TaintFact[] = [];
    const capturedFieldName = taintedLocal.getName?.() || "";
    if (!capturedFieldName) return results;

    for (const stmt of cfg.getStmts()) {
        if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
        const invokeExpr = stmt.getInvokeExpr();
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
        if (resolvePromiseContinuationKind(invokeExpr) !== "finally") continue;

        const callbackBindings = resolvePromiseContinuationCallbackBindings(
            scene,
            invokeExpr,
            "finally",
            "unknown",
        );
        for (const callbackBinding of callbackBindings) {
            results.push(...collectSpecificFinallyCallbackCaptureFieldFacts(
                pag,
                callbackBinding.callbackMethod,
                capturedFieldName,
                source,
                currentCtx,
                fieldPath,
            ));
        }
    }

    return results;
}

function collectPromiseCallbackFactsByReceiverLocal(
    scene: Scene,
    pag: Pag,
    receiverLocal: Local,
    source: string,
    currentCtx: number,
    fieldPath?: string[],
    settlementHint: PromiseSettlementHint = "unknown",
): TaintFact[] {
    const results: TaintFact[] = [];

    for (const stmt of receiverLocal.getUsedStmts()) {
        if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
        const invokeExpr = stmt.getInvokeExpr();
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
        if (invokeExpr.getBase() !== receiverLocal) continue;

        const continuationKind = resolvePromiseContinuationKind(invokeExpr);
        if (!continuationKind) continue;

        const callbackBindings = resolvePromiseContinuationCallbackBindings(
            scene,
            invokeExpr,
            continuationKind,
            settlementHint,
        );
        for (const callbackBinding of callbackBindings) {
            const callbackFacts = collectContinuationCallbackEntryFacts(
                pag,
                callbackBinding.callbackMethod,
                callbackBinding.continuationKind,
                source,
                currentCtx,
                fieldPath,
            );
            for (const newFact of callbackFacts) {
                results.push(newFact);
            }
        }

        if (stmt instanceof ArkAssignStmt) {
            const resultFacts = collectContinuationResultFacts(
                scene,
                pag,
                receiverLocal,
                stmt,
                invokeExpr,
                callbackBindings,
                continuationKind,
                settlementHint,
                source,
                currentCtx,
                fieldPath,
            );
            for (const newFact of resultFacts) {
                results.push(newFact);
            }
        }
    }

    return results;
}

function resolvePromiseContinuationKind(invokeExpr: ArkInstanceInvokeExpr): PromiseContinuationKind | undefined {
    return detectDeferredCompletionKind(invokeExpr);
}

function resolvePromiseContinuationCallbackBindings(
    scene: Scene,
    invokeExpr: ArkInstanceInvokeExpr,
    continuationKind: PromiseContinuationKind,
    settlementHint: PromiseSettlementHint,
): Array<{ callbackMethod: ArkMethod; continuationKind: PromiseContinuationKind }> {
    const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    const callbackArgIndexes = resolvePromiseContinuationCallbackArgIndexes(continuationKind, args.length, settlementHint);
    if (callbackArgIndexes.length === 0) return [];

    const out: Array<{ callbackMethod: ArkMethod; continuationKind: PromiseContinuationKind }> = [];
    const seen = new Set<string>();
    for (const callbackArgIndex of callbackArgIndexes) {
        const callbackArg = args[callbackArgIndex];
        if (!callbackArg) continue;
        for (const callbackMethod of resolveOrdinaryCallbackMethods(scene, callbackArg)) {
            const signature = callbackMethod.getSignature?.().toString?.();
            if (!signature) continue;
            const key = `${signature}|kind:${continuationKind}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ callbackMethod, continuationKind });
        }
    }
    return out;
}

function resolvePromiseContinuationCallbackArgIndexes(
    continuationKind: PromiseContinuationKind,
    argCount: number,
    settlementHint: PromiseSettlementHint,
): number[] {
    return resolveDeferredCompletionCallbackArgIndexes(
        continuationKind,
        argCount,
        settlementHint,
    );
}

function collectContinuationCallbackEntryFacts(
    pag: Pag,
    callbackMethod: ArkMethod,
    continuationKind: PromiseContinuationKind,
    source: string,
    currentCtx: number,
    fieldPath?: string[],
): TaintFact[] {
    const results: TaintFact[] = [];
    if (continuationKind === "finally") {
        return collectFinallyCallbackCaptureFieldFacts(
            pag,
            callbackMethod,
            source,
            currentCtx,
            fieldPath,
        );
    }
    const cfg = callbackMethod.getCfg();
    if (!cfg) return results;

    const paramAssigns = cfg.getStmts()
        .filter((s: any) => s instanceof ArkAssignStmt && s.getRightOp() instanceof ArkParameterRef) as ArkAssignStmt[];
    for (const paramAssign of paramAssigns) {
        if (!shouldSeedContinuationEntryParam(paramAssign, continuationKind)) continue;
        const nodes = safeGetOrCreatePagNodes(pag, paramAssign.getLeftOp(), paramAssign);
        if (!nodes) continue;
        for (const nodeId of nodes.values()) {
            const node = pag.getNode(nodeId) as PagNode;
            if (!node) continue;
            results.push(new TaintFact(
                node,
                source,
                currentCtx,
                fieldPath ? [...fieldPath] : undefined,
            ));
        }
    }
    return results;
}

function collectFinallyCallbackCaptureFieldFacts(
    pag: Pag,
    callbackMethod: ArkMethod,
    source: string,
    currentCtx: number,
    fieldPath?: string[],
): TaintFact[] {
    return collectSpecificFinallyCallbackCaptureFieldFacts(
        pag,
        callbackMethod,
        undefined,
        source,
        currentCtx,
        fieldPath,
    );
}

function collectSpecificFinallyCallbackCaptureFieldFacts(
    pag: Pag,
    callbackMethod: ArkMethod,
    expectedFieldName: string | undefined,
    source: string,
    currentCtx: number,
    fieldPath?: string[],
): TaintFact[] {
    const results: TaintFact[] = [];
    for (const mapping of collectFinallyClosureFieldReads(callbackMethod)) {
        if (expectedFieldName && mapping.fieldName !== expectedFieldName) continue;
        const carrierNodes = safeGetOrCreatePagNodes(pag, mapping.carrierLocal, mapping.anchorStmt);
        if (!carrierNodes) continue;
        const carriedFieldPath = fieldPath && fieldPath.length > 0
            ? [mapping.fieldName, ...fieldPath]
            : [mapping.fieldName];
        for (const nodeId of carrierNodes.values()) {
            const node = pag.getNode(nodeId) as PagNode;
            if (!node) continue;
            results.push(new TaintFact(
                node,
                source,
                currentCtx,
                carriedFieldPath,
            ));
        }

        const localNodes = safeGetOrCreatePagNodes(pag, mapping.callbackLocal, mapping.anchorStmt);
        if (!localNodes) continue;
        for (const nodeId of localNodes.values()) {
            const node = pag.getNode(nodeId) as PagNode;
            if (!node) continue;
            results.push(new TaintFact(
                node,
                source,
                currentCtx,
                fieldPath ? [...fieldPath] : undefined,
            ));
        }
    }
    return results;
}

function collectContinuationResultFacts(
    scene: Scene,
    pag: Pag,
    receiverLocal: Local,
    continuationAssignStmt: ArkAssignStmt,
    continuationInvokeExpr: ArkInstanceInvokeExpr,
    callbackBindings: Array<{ callbackMethod: ArkMethod; continuationKind: PromiseContinuationKind }>,
    continuationKind: PromiseContinuationKind,
    settlementHint: PromiseSettlementHint,
    source: string,
    currentCtx: number,
    fieldPath?: string[],
): TaintFact[] {
    const results: TaintFact[] = [];
    const resultNodes = safeGetOrCreatePagNodes(pag, continuationAssignStmt.getLeftOp(), continuationAssignStmt);
    if (!resultNodes || resultNodes.size === 0) return results;

    if (continuationKind === "finally") {
        for (const nodeId of resultNodes.values()) {
            const node = pag.getNode(nodeId) as PagNode;
            if (!node) continue;
            results.push(new TaintFact(
                node,
                source,
                currentCtx,
                fieldPath ? [...fieldPath] : undefined,
            ));
        }
        return results;
    }

    if (shouldPassthroughUnhandledSettlement(
        continuationInvokeExpr,
        continuationKind,
        settlementHint,
    )) {
        for (const nodeId of resultNodes.values()) {
            const node = pag.getNode(nodeId) as PagNode;
            if (!node) continue;
            results.push(new TaintFact(
                node,
                source,
                currentCtx,
                fieldPath ? [...fieldPath] : undefined,
            ));
        }
    }

    for (const callbackBinding of callbackBindings) {
        if (!callbackReturnsTaintedValue(callbackBinding.callbackMethod, callbackBinding.continuationKind)) {
            continue;
        }
        for (const nodeId of resultNodes.values()) {
            const node = pag.getNode(nodeId) as PagNode;
            if (!node) continue;
            results.push(new TaintFact(
                node,
                source,
                currentCtx,
                fieldPath ? [...fieldPath] : undefined,
            ));
        }
    }

    const downstreamFinallyFacts = collectDownstreamFinallyCaptureFacts(
        scene,
        pag,
        continuationAssignStmt,
        callbackBindings,
        source,
        currentCtx,
        fieldPath,
    );
    for (const fact of downstreamFinallyFacts) {
        results.push(fact);
    }

    return results;
}

function shouldPassthroughUnhandledSettlement(
    continuationInvokeExpr: ArkInstanceInvokeExpr,
    continuationKind: PromiseContinuationKind,
    settlementHint: PromiseSettlementHint,
): boolean {
    const args = continuationInvokeExpr.getArgs ? continuationInvokeExpr.getArgs() : [];
    return shouldPassthroughDeferredCompletion(
        continuationKind,
        args.length,
        settlementHint,
    );
}

function collectDownstreamFinallyCaptureFacts(
    scene: Scene,
    pag: Pag,
    continuationAssignStmt: ArkAssignStmt,
    callbackBindings: Array<{ callbackMethod: ArkMethod; continuationKind: PromiseContinuationKind }>,
    source: string,
    currentCtx: number,
    fieldPath?: string[],
): TaintFact[] {
    const writtenCaptureFields = new Set<string>();
    for (const callbackBinding of callbackBindings) {
        for (const fieldName of collectTaintedCaptureWriteFieldNames(
            callbackBinding.callbackMethod,
            callbackBinding.continuationKind,
        )) {
            writtenCaptureFields.add(fieldName);
        }
    }
    if (writtenCaptureFields.size === 0) return [];

    const startLocal = continuationAssignStmt.getLeftOp();
    if (!(startLocal instanceof Local)) return [];

    const results: TaintFact[] = [];
    const queue: Local[] = [startLocal];
    const seenLocals = new Set<string>();
    while (queue.length > 0) {
        const currentLocal = queue.shift()!;
        const localKey = `${currentLocal.getDeclaringStmt?.()?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || ""}#${currentLocal.getName?.() || ""}`;
        if (seenLocals.has(localKey)) continue;
        seenLocals.add(localKey);

        for (const stmt of currentLocal.getUsedStmts()) {
            if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
            if (invokeExpr.getBase() !== currentLocal) continue;

            const continuationKind = resolvePromiseContinuationKind(invokeExpr);
            if (!continuationKind) continue;

            if (continuationKind === "finally") {
                const finallyBindings = resolvePromiseContinuationCallbackBindings(
                    scene,
                    invokeExpr,
                    "finally",
                    "unknown",
                );
                for (const finallyBinding of finallyBindings) {
                    for (const fieldName of writtenCaptureFields) {
                        results.push(...collectSpecificFinallyCallbackCaptureFieldFacts(
                            pag,
                            finallyBinding.callbackMethod,
                            fieldName,
                            source,
                            currentCtx,
                            fieldPath,
                        ));
                    }
                }
                continue;
            }

            if (!(stmt instanceof ArkAssignStmt)) continue;
            const nextLocal = stmt.getLeftOp();
            if (!(nextLocal instanceof Local)) continue;
            queue.push(nextLocal);
        }
    }

    return results;
}

function collectTaintedCaptureWriteFieldNames(
    callbackMethod: ArkMethod,
    continuationKind: PromiseContinuationKind,
): string[] {
    if (continuationKind === "finally") return [];
    const cfg = callbackMethod.getCfg();
    if (!cfg) return [];

    const seededParamNames = new Set<string>();
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof Local) || !(right instanceof ArkParameterRef)) continue;
        if (!shouldSeedContinuationEntryParam(stmt, continuationKind)) continue;
        seededParamNames.add(left.getName());
    }
    if (seededParamNames.size === 0) return [];

    const capturedLocalFields = new Map<string, Set<string>>();
    for (const mapping of collectFinallyClosureFieldReads(callbackMethod)) {
        if (!capturedLocalFields.has(mapping.callbackLocal.getName())) {
            capturedLocalFields.set(mapping.callbackLocal.getName(), new Set<string>());
        }
        capturedLocalFields.get(mapping.callbackLocal.getName())!.add(mapping.fieldName);
    }
    if (capturedLocalFields.size === 0) return [];

    const out = new Set<string>();
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof Local)) continue;
        const fieldNames = capturedLocalFields.get(left.getName());
        if (!fieldNames || fieldNames.size === 0) continue;
        const taintedWrite = right instanceof Local
            ? isLocalTransitivelyDerivedFromSeed(right, seededParamNames, new Set<string>())
            : (right?.getUses?.() || []).some((use: any) => use instanceof Local
                && isLocalTransitivelyDerivedFromSeed(use, seededParamNames, new Set<string>()));
        if (!taintedWrite) continue;
        for (const fieldName of fieldNames) {
            out.add(fieldName);
        }
    }

    return [...out];
}

function collectFinallyClosureFieldReads(
    callbackMethod: ArkMethod,
): Array<{ carrierLocal: Local; callbackLocal: Local; fieldName: string; anchorStmt: ArkAssignStmt }> {
    const results: Array<{ carrierLocal: Local; callbackLocal: Local; fieldName: string; anchorStmt: ArkAssignStmt }> = [];
    const cfg = callbackMethod.getCfg();
    if (!cfg) return results;

    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof Local)) continue;
        if (!(right instanceof ArkInstanceFieldRef) && !(right instanceof ClosureFieldRef)) continue;

        const base = right.getBase?.();
        if (!(base instanceof Local)) continue;
        const isClosureCarrier = right instanceof ClosureFieldRef || base.getName().startsWith("%closures");
        if (!isClosureCarrier) continue;

        const fieldName = right instanceof ClosureFieldRef
            ? right.getFieldName?.()
            : right.getFieldSignature?.().getFieldName?.();
        if (!fieldName) continue;
        results.push({
            carrierLocal: base,
            callbackLocal: left,
            fieldName,
            anchorStmt: stmt,
        });
    }

    return results;
}

function resolveOrdinaryCallbackMethods(scene: Scene, callbackArg: any): ArkMethod[] {
    const methods: ArkMethod[] = [];
    const seen = new Set<string>();

    const addMethod = (method: ArkMethod): void => {
        const sig = method?.getSignature?.().toString?.();
        if (!sig || seen.has(sig)) return;
        seen.add(sig);
        methods.push(method);
    };

    const callableMethods = resolveCallbackMethodsFromValueWithReturns(scene, callbackArg, { maxDepth: 6 });
    for (const method of callableMethods) {
        addMethod(method as ArkMethod);
    }
    if (methods.length > 0) return methods;

    const candidateNames = new Set<string>();
    if (callbackArg instanceof Local) {
        candidateNames.add(callbackArg.getName());
    }
    const text = callbackArg?.toString?.() || "";
    if (text) {
        candidateNames.add(text);
    }

    for (const name of candidateNames) {
        const matched = scene.getMethods().filter(method => method.getName() === name);
        for (const method of matched) {
            addMethod(method);
        }
    }

    return methods;
}

function callbackReturnsTaintedValue(
    callbackMethod: ArkMethod,
    continuationKind: PromiseContinuationKind,
): boolean {
    if (continuationKind === "finally") return false;
    const cfg = callbackMethod.getCfg();
    if (!cfg) return false;

    const seededParamNames = new Set<string>();
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof Local)) continue;
        if (!(right instanceof ArkParameterRef)) continue;
        if (!shouldSeedContinuationEntryParam(stmt, continuationKind)) continue;
        seededParamNames.add(left.getName());
    }
    if (seededParamNames.size === 0) return false;

    for (const rawRetStmt of callbackMethod.getReturnStmt?.() || []) {
        const retStmt = rawRetStmt as ArkReturnStmt;
        const retValue = retStmt.getOp?.();
        if (!(retValue instanceof Local)) continue;
        if (isLocalTransitivelyDerivedFromSeed(retValue, seededParamNames, new Set<string>())) {
            return true;
        }
    }
    return false;
}

function isLocalTransitivelyDerivedFromSeed(
    local: Local,
    seededParamNames: Set<string>,
    visited: Set<string>,
): boolean {
    const name = local.getName?.() || "";
    if (seededParamNames.has(name)) return true;

    const declStmt = local.getDeclaringStmt?.();
    if (!(declStmt instanceof ArkAssignStmt) || declStmt.getLeftOp() !== local) {
        return false;
    }
    const methodSig = declStmt.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
    const visitKey = `${methodSig}#${name}#${declStmt.getOriginPositionInfo?.()?.getLineNo?.() || -1}`;
    if (visited.has(visitKey)) return false;
    visited.add(visitKey);

    const rightOp = declStmt.getRightOp();
    if (rightOp instanceof Local) {
        return isLocalTransitivelyDerivedFromSeed(rightOp, seededParamNames, visited);
    }

    const uses = rightOp?.getUses?.() || [];
    for (const use of uses) {
        if (use instanceof Local && isLocalTransitivelyDerivedFromSeed(use, seededParamNames, visited)) {
            return true;
        }
    }
    return false;
}

function resolvePromiseSettlementHintForReceiverLocal(receiverLocal: Local): PromiseSettlementHint {
    const declStmt = receiverLocal.getDeclaringStmt?.();
    if (!(declStmt instanceof ArkAssignStmt) || declStmt.getLeftOp() !== receiverLocal) {
        return "unknown";
    }
    return resolvePromiseSettlementHintFromInvoke(declStmt.getRightOp());
}

function resolvePromiseSettlementHintFromInvoke(invokeExpr: any): PromiseSettlementHint {
    const methodName = invokeExpr?.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
    const sig = invokeExpr?.getMethodSignature?.()?.toString?.() || "";
    if (methodName === "resolve" || sig.includes(".resolve(")) return "fulfilled";
    if (methodName === "reject" || sig.includes(".reject(")) return "rejected";
    return "unknown";
}

function shouldSeedContinuationEntryParam(
    paramAssign: ArkAssignStmt,
    continuationKind: PromiseContinuationKind,
): boolean {
    const rightOp = paramAssign.getRightOp();
    if (!(rightOp instanceof ArkParameterRef)) return false;
    if (continuationKind === "finally") return false;
    return true;
}
