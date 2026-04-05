import { Pag, PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt, ArkReturnStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { ArkInstanceFieldRef, ArkParameterRef, ClosureFieldRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { ArkMethod } from "../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { fromContainerFieldKey } from "../model/ContainerSlotKeys";
import { TaintFact } from "../model/TaintFact";
import { safeGetOrCreatePagNodes } from "../contracts/PagNodeResolution";
import { collectParameterAssignStmts } from "../../substrate/queries/CalleeResolver";
import { ExecutionHandoffContractRecord } from "./ExecutionHandoffContract";
import { buildExecutionHandoffSiteKeyFromStmt } from "./ExecutionHandoffSiteKey";

export type ExecutionHandoffPromiseContractIndex = Map<string, ExecutionHandoffContractRecord[]>;

export function shouldPropagateExecutionHandoffPromiseCallbacks(fieldPath?: string[]): boolean {
    return !fieldPath
        || fieldPath.length === 0
        || fromContainerFieldKey(fieldPath[0]) !== null;
}

export function collectExecutionHandoffPromiseCallbackFactsFromTaintedReceiver(
    pag: Pag,
    receiverLocal: Local,
    source: string,
    currentCtx: number,
    promiseContractsBySiteKey?: ExecutionHandoffPromiseContractIndex,
    fieldPath?: string[],
): TaintFact[] {
    if (!promiseContractsBySiteKey || promiseContractsBySiteKey.size === 0) return [];
    const results: TaintFact[] = [];

    for (const stmt of receiverLocal.getUsedStmts()) {
        if (!stmt?.containsInvokeExpr?.() || !stmt.containsInvokeExpr()) continue;
        const contracts = collectPromiseContractsForStmt(promiseContractsBySiteKey, stmt);
        if (contracts.length === 0) continue;

        for (const contract of contracts) {
            for (const fact of collectContinuationCallbackEntryFacts(
                pag,
                contract.unit,
                contract.semantics.continuationRole,
                source,
                currentCtx,
                fieldPath,
            )) {
                results.push(fact);
            }

            if (stmt instanceof ArkAssignStmt) {
                for (const fact of collectContinuationResultFacts(
                    pag,
                    promiseContractsBySiteKey,
                    stmt,
                    contract,
                    source,
                    currentCtx,
                    fieldPath,
                )) {
                    results.push(fact);
                }
            }
        }
    }

    return results;
}

export function collectExecutionHandoffPromiseCallbackFactsFromTaintedArg(
    pag: Pag,
    taintedLocal: Local,
    source: string,
    currentCtx: number,
    promiseContractsBySiteKey?: ExecutionHandoffPromiseContractIndex,
    fieldPath?: string[],
): TaintFact[] {
    if (!promiseContractsBySiteKey || promiseContractsBySiteKey.size === 0) return [];
    const results: TaintFact[] = [];

    for (const stmt of taintedLocal.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const rightOp: any = stmt.getRightOp?.();
        const invokeExpr = rightOp?.getArgs ? rightOp : undefined;
        if (!invokeExpr) continue;

        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        if (!args.includes(taintedLocal)) continue;

        const leftOp = stmt.getLeftOp?.();
        if (!(leftOp instanceof Local)) continue;
        for (const fact of collectExecutionHandoffPromiseCallbackFactsFromTaintedReceiver(
            pag,
            leftOp,
            source,
            currentCtx,
            promiseContractsBySiteKey,
            fieldPath,
        )) {
            results.push(fact);
        }
    }

    return results;
}

export function collectExecutionHandoffPromiseFinallyCaptureFactsFromTaintedLocal(
    pag: Pag,
    taintedLocal: Local,
    source: string,
    currentCtx: number,
    promiseContractsBySiteKey?: ExecutionHandoffPromiseContractIndex,
    fieldPath?: string[],
): TaintFact[] {
    if (!promiseContractsBySiteKey || promiseContractsBySiteKey.size === 0) return [];
    const declaringStmt = taintedLocal.getDeclaringStmt?.();
    const callerMethod = declaringStmt?.getCfg?.()?.getDeclaringMethod?.();
    const cfg = callerMethod?.getCfg?.();
    if (!cfg) return [];

    const results: TaintFact[] = [];
    const capturedFieldName = taintedLocal.getName?.() || "";
    if (!capturedFieldName) return results;

    for (const stmt of cfg.getStmts()) {
        if (!stmt?.containsInvokeExpr?.() || !stmt.containsInvokeExpr()) continue;
        const contracts = collectPromiseContractsForStmt(promiseContractsBySiteKey, stmt)
            .filter(contract => contract.semantics.continuationRole === "observe");
        if (contracts.length === 0) continue;

        for (const contract of contracts) {
            for (const fact of collectSpecificFinallyCallbackCaptureFieldFacts(
                pag,
                contract.unit,
                capturedFieldName,
                source,
                currentCtx,
                fieldPath,
            )) {
                results.push(fact);
            }
        }
    }

    return results;
}

function collectPromiseContractsForStmt(
    promiseContractsBySiteKey: ExecutionHandoffPromiseContractIndex,
    stmt: any,
): ExecutionHandoffContractRecord[] {
    const siteKey = buildExecutionHandoffSiteKeyFromStmt(undefined, stmt);
    return promiseContractsBySiteKey.get(siteKey) || [];
}

function collectContinuationCallbackEntryFacts(
    pag: Pag,
    callbackMethod: ArkMethod,
    continuationRole: ExecutionHandoffContractRecord["semantics"]["continuationRole"],
    source: string,
    currentCtx: number,
    fieldPath?: string[],
): TaintFact[] {
    if (continuationRole === "observe") {
        return collectFinallyCallbackCaptureFieldFacts(
            pag,
            callbackMethod,
            source,
            currentCtx,
            fieldPath,
        );
    }

    const results: TaintFact[] = [];
    const cfg = callbackMethod.getCfg?.();
    if (!cfg) return results;

    const paramAssigns = cfg.getStmts()
        .filter((stmt: any) => stmt instanceof ArkAssignStmt && stmt.getRightOp() instanceof ArkParameterRef) as ArkAssignStmt[];
    for (const paramAssign of paramAssigns) {
        if (!shouldSeedContinuationEntryParam(paramAssign, continuationRole)) continue;
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

function collectContinuationResultFacts(
    pag: Pag,
    promiseContractsBySiteKey: ExecutionHandoffPromiseContractIndex,
    continuationAssignStmt: ArkAssignStmt,
    contract: ExecutionHandoffContractRecord,
    source: string,
    currentCtx: number,
    fieldPath?: string[],
): TaintFact[] {
    const results: TaintFact[] = [];
    const resultNodes = safeGetOrCreatePagNodes(pag, continuationAssignStmt.getLeftOp(), continuationAssignStmt);
    if (!resultNodes || resultNodes.size === 0) return results;

    if (contract.ports.preserve !== "preserve0" || callbackReturnsTaintedValue(contract.unit, contract.semantics.continuationRole)) {
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

    for (const fact of collectDownstreamFinallyCaptureFacts(
        pag,
        promiseContractsBySiteKey,
        continuationAssignStmt,
        contract,
        source,
        currentCtx,
        fieldPath,
    )) {
        results.push(fact);
    }

    return results;
}

function collectDownstreamFinallyCaptureFacts(
    pag: Pag,
    promiseContractsBySiteKey: ExecutionHandoffPromiseContractIndex,
    continuationAssignStmt: ArkAssignStmt,
    contract: ExecutionHandoffContractRecord,
    source: string,
    currentCtx: number,
    fieldPath?: string[],
): TaintFact[] {
    const writtenCaptureFields = new Set<string>();
    for (const fieldName of collectTaintedCaptureWriteFieldNames(
        contract.unit,
        contract.semantics.continuationRole,
    )) {
        writtenCaptureFields.add(fieldName);
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
            if (!stmt?.containsInvokeExpr?.() || !stmt.containsInvokeExpr()) continue;
            const contracts = collectPromiseContractsForStmt(promiseContractsBySiteKey, stmt);
            if (contracts.length === 0) continue;

            const observeContracts = contracts.filter(item => item.semantics.continuationRole === "observe");
            for (const observeContract of observeContracts) {
                for (const fieldName of writtenCaptureFields) {
                    for (const fact of collectSpecificFinallyCallbackCaptureFieldFacts(
                        pag,
                        observeContract.unit,
                        fieldName,
                        source,
                        currentCtx,
                        fieldPath,
                    )) {
                        results.push(fact);
                    }
                }
            }

            if (!(stmt instanceof ArkAssignStmt)) continue;
            const nextLocal = stmt.getLeftOp();
            if (!(nextLocal instanceof Local)) continue;
            queue.push(nextLocal);
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

function collectTaintedCaptureWriteFieldNames(
    callbackMethod: ArkMethod,
    continuationRole: ExecutionHandoffContractRecord["semantics"]["continuationRole"],
): string[] {
    if (continuationRole === "observe") return [];
    const cfg = callbackMethod.getCfg?.();
    if (!cfg) return [];

    const seededParamNames = new Set<string>();
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof Local) || !(right instanceof ArkParameterRef)) continue;
        if (!shouldSeedContinuationEntryParam(stmt, continuationRole)) continue;
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
    const cfg = callbackMethod.getCfg?.();
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

function callbackReturnsTaintedValue(
    callbackMethod: ArkMethod,
    continuationRole: ExecutionHandoffContractRecord["semantics"]["continuationRole"],
): boolean {
    if (continuationRole === "observe") return false;
    const cfg = callbackMethod.getCfg?.();
    if (!cfg) return false;

    const seededParamNames = new Set<string>();
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof Local) || !(right instanceof ArkParameterRef)) continue;
        if (!shouldSeedContinuationEntryParam(stmt, continuationRole)) continue;
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

function shouldSeedContinuationEntryParam(
    paramAssign: ArkAssignStmt,
    continuationRole: ExecutionHandoffContractRecord["semantics"]["continuationRole"],
): boolean {
    const rightOp = paramAssign.getRightOp();
    if (!(rightOp instanceof ArkParameterRef)) return false;
    return continuationRole !== "observe";
}
