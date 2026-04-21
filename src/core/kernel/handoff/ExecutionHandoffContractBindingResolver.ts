import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { CallGraph } from "../../../../arkanalyzer/out/src/callgraph/model/CallGraph";
import { Pag } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt, ArkReturnStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { ArkInstanceFieldRef, ArkParameterRef, ArkThisRef, ClosureFieldRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { ArkInstanceInvokeExpr, ArkPtrInvokeExpr, ArkStaticInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { CallEdgeType } from "../context/TaintContext";
import { safeGetOrCreatePagNodes } from "../contracts/PagNodeResolution";
import {
    collectParameterAssignStmts,
    resolveCalleeCandidates,
    resolveInvokeMethodName,
    resolveMethodsFromCallable,
} from "../../substrate/queries/CalleeResolver";
import { collectOrdinaryTaintPreservingSourceLocals } from "../ordinary/OrdinaryLanguagePropagation";
import { resolveQualifiedDeclarativeFieldTriggerToken } from "../model/DeclarativeFieldTriggerSemantics";
import type {
    ExecutionHandoffContractRecord,
    ExecutionHandoffResolvedEdgeBinding,
} from "./ExecutionHandoffContract";

export function buildExecutionHandoffContractEdgeBindings(
    scene: Scene,
    _cg: CallGraph,
    pag: Pag,
    contract: ExecutionHandoffContractRecord,
): ExecutionHandoffResolvedEdgeBinding[] {
    const bindings: ExecutionHandoffResolvedEdgeBinding[] = [];
    bindings.push(...resolveActivationBindings(pag, contract));
    bindings.push(...resolvePayloadBindings(scene, pag, contract));
    bindings.push(...resolveEnvBindings(scene, pag, contract));
    bindings.push(...resolveCompletionBindings(scene, pag, contract));
    return bindings.filter(binding => binding.sourceNodeIds.length > 0 && binding.targetNodeIds.length > 0);
}

function resolveActivationBindings(
    pag: Pag,
    contract: ExecutionHandoffContractRecord,
): ExecutionHandoffResolvedEdgeBinding[] {
    const sourceNodeIds = collectActivationSourceNodeIds(pag, contract);
    const targetNodeIds = collectActivationTargetNodeIds(pag, contract.unit);
    if (sourceNodeIds.length === 0 || targetNodeIds.length === 0) {
        return [];
    }
    return [{
        edgeType: CallEdgeType.CALL,
        sourceNodeIds,
        targetNodeIds,
    }];
}

function resolvePayloadBindings(
    scene: Scene,
    pag: Pag,
    contract: ExecutionHandoffContractRecord,
): ExecutionHandoffResolvedEdgeBinding[] {
    if (contract.ports.payload !== "payload+") {
        return [];
    }

    const explicitSourceNodes = collectPayloadSourceNodeIds(scene, pag, contract);
    if (explicitSourceNodes.length === 0) {
        return [];
    }

    const paramStmts = collectParameterAssignStmts(contract.unit);
    if (paramStmts.length === 0) {
        return [];
    }

    const bindings: ExecutionHandoffResolvedEdgeBinding[] = [];
    for (const paramStmt of paramStmts) {
        const paramLocal = paramStmt.getLeftOp?.();
        if (!(paramLocal instanceof Local)) continue;
        if ((paramLocal.getName?.() || "").startsWith("%closures")) continue;
        const rightOp = paramStmt.getRightOp?.();
        if (!(rightOp instanceof ArkParameterRef)) continue;
        const targetNodeIds = collectNodeIds(
            safeGetOrCreatePagNodes(pag, paramLocal, paramStmt),
        );
        if (targetNodeIds.length === 0) continue;
        bindings.push({
            edgeType: CallEdgeType.CALL,
            sourceNodeIds: explicitSourceNodes,
            targetNodeIds,
        });
    }

    return bindings;
}

function collectPayloadSourceNodeIds(
    scene: Scene,
    pag: Pag,
    contract: ExecutionHandoffContractRecord,
): number[] {
    const explicitSourceNodeIds = resolveExplicitSourceSelectorNodeIds(pag, contract, contract.payloadSource);
    if (explicitSourceNodeIds.length > 0) {
        return explicitSourceNodeIds;
    }
    if (isPromiseSettlementActivation(contract.activation)) {
        const promiseSourceNodeIds = collectPromiseSettlementSourceNodeIds(scene, pag, contract);
        if (promiseSourceNodeIds.length > 0) {
            return promiseSourceNodeIds;
        }
    }
    return collectInvokeBaseNodeIds(pag, contract);
}

function collectPromiseSettlementSourceNodeIds(
    scene: Scene,
    pag: Pag,
    contract: ExecutionHandoffContractRecord,
): number[] {
    return collectPromiseSettlementSourceNodeIdsForActivation(
        scene,
        pag,
        contract,
        contract.activation,
    );
}

function collectPromiseSettlementSourceNodeIdsForActivation(
    scene: Scene,
    pag: Pag,
    contract: ExecutionHandoffContractRecord,
    activation: ExecutionHandoffContractRecord["activation"],
): number[] {
    const baseValue = contract.invokeExpr?.getBase?.();
    if (!(baseValue instanceof Local)) {
        return [];
    }
    return resolvePromiseSettlementSourceNodeIdsFromLocal(
        scene,
        pag,
        baseValue,
        contract.stmt,
        activation,
        new Set<string>(),
    );
}

function resolvePromiseSettlementSourceNodeIdsFromLocal(
    scene: Scene,
    pag: Pag,
    local: Local,
    anchorStmt: any,
    activation: ExecutionHandoffContractRecord["activation"],
    visited: Set<string>,
): number[] {
    const localKey = `${resolveDeclaringMethodSignature(local)}#${local.getName?.() || ""}#${local.getDeclaringStmt?.()?.toString?.() || ""}`;
    if (visited.has(localKey)) {
        return collectNodeIds(safeGetOrCreatePagNodes(pag, local, anchorStmt));
    }
    visited.add(localKey);

    const ownerMethod = anchorStmt?.getCfg?.()?.getDeclaringMethod?.()
        || local.getDeclaringStmt?.()?.getCfg?.()?.getDeclaringMethod?.();
    const declaringStmt = resolveLatestAssignStmtForLocal(ownerMethod, local, anchorStmt)
        || local.getDeclaringStmt?.();
    if (declaringStmt instanceof ArkAssignStmt && declaringStmt.getLeftOp?.() === local) {
        const rightOp = declaringStmt.getRightOp?.();
        if (isPromiseResolveRejectInvoke(rightOp, activation)) {
            return collectInvokeArgNodeIds(pag, rightOp, declaringStmt);
        }
        if (isDeferredContinuationInvoke(rightOp)) {
            return collectNodeIds(safeGetOrCreatePagNodes(pag, local, declaringStmt));
        }
        if (isPromiseProducingInvoke(rightOp)) {
            const calleeSourceNodeIds = resolvePromiseSettlementSourceNodeIdsFromInvoke(
                scene,
                pag,
                rightOp,
                activation,
                visited,
            );
            if (calleeSourceNodeIds.length > 0) {
                return calleeSourceNodeIds;
            }
        }
        if (rightOp instanceof Local) {
            return resolvePromiseSettlementSourceNodeIdsFromLocal(
                scene,
                pag,
                rightOp,
                declaringStmt,
                activation,
                visited,
            );
        }
    }

    return collectNodeIds(safeGetOrCreatePagNodes(pag, local, anchorStmt));
}

function resolvePromiseSettlementSourceNodeIdsFromInvoke(
    scene: Scene,
    pag: Pag,
    invokeExpr: any,
    activation: ExecutionHandoffContractRecord["activation"],
    visited: Set<string>,
): number[] {
    const sourceNodeIds: number[] = [];
    for (const resolved of resolveCalleeCandidates(scene, invokeExpr)) {
        sourceNodeIds.push(
            ...collectPromiseSettlementSourceNodeIdsFromMethod(
                scene,
                pag,
                resolved.method,
                activation,
                visited,
            ),
        );
    }
    return dedupeNodeIds(sourceNodeIds);
}

function collectPromiseSettlementSourceNodeIdsFromMethod(
    scene: Scene,
    pag: Pag,
    method: any,
    activation: ExecutionHandoffContractRecord["activation"],
    visited: Set<string>,
): number[] {
    const sourceNodeIds: number[] = [];
    for (const retStmt of method.getReturnStmt?.() || []) {
        if (!(retStmt instanceof ArkReturnStmt)) continue;
        const retValue = retStmt.getOp?.();
        if (!(retValue instanceof Local)) continue;
        sourceNodeIds.push(
            ...resolvePromiseSettlementSourceNodeIdsFromReturnedLocal(
                scene,
                pag,
                method,
                retValue,
                activation,
                visited,
            ),
        );
    }
    return dedupeNodeIds(sourceNodeIds);
}

function resolvePromiseSettlementSourceNodeIdsFromReturnedLocal(
    scene: Scene,
    pag: Pag,
    method: any,
    local: Local,
    activation: ExecutionHandoffContractRecord["activation"],
    visited: Set<string>,
): number[] {
    const declaringStmt = resolveLatestAssignStmtForLocal(method, local)
        || local.getDeclaringStmt?.();
    if (declaringStmt instanceof ArkAssignStmt && declaringStmt.getLeftOp?.() === local) {
        const rightOp = declaringStmt.getRightOp?.();
        if (isPromiseResolveRejectInvoke(rightOp, activation)) {
            return collectInvokeArgNodeIds(pag, rightOp, declaringStmt);
        }
        if (isPromiseConstructorInvoke(rightOp)) {
            const executorSourceNodeIds = collectPromiseConstructorSettlementSourceNodeIds(
                scene,
                pag,
                rightOp,
                activation,
            );
            if (executorSourceNodeIds.length > 0) {
                return executorSourceNodeIds;
            }
        }
        if (isPromiseProducingInvoke(rightOp)) {
            const nestedSourceNodeIds = resolvePromiseSettlementSourceNodeIdsFromInvoke(
                scene,
                pag,
                rightOp,
                activation,
                visited,
            );
            if (nestedSourceNodeIds.length > 0) {
                return nestedSourceNodeIds;
            }
        }
        if (rightOp instanceof Local) {
            return resolvePromiseSettlementSourceNodeIdsFromLocal(
                scene,
                pag,
                rightOp,
                declaringStmt,
                activation,
                visited,
            );
        }
    }

    return collectNodeIds(
        safeGetOrCreatePagNodes(pag, local, firstMethodStmt(method) || declaringStmt),
    );
}

function collectPromiseConstructorSettlementSourceNodeIds(
    scene: Scene,
    pag: Pag,
    constructorInvoke: any,
    activation: ExecutionHandoffContractRecord["activation"],
): number[] {
    const invokeArgs = constructorInvoke?.getArgs?.() || [];
    const sourceNodeIds: number[] = [];
    for (const arg of invokeArgs) {
        for (const executorMethod of resolveMethodsFromCallable(scene, arg)) {
            sourceNodeIds.push(
                ...collectPromiseSettlementArgNodeIdsFromExecutor(
                    pag,
                    executorMethod,
                    activation,
                ),
            );
        }
    }
    return dedupeNodeIds(sourceNodeIds);
}

function collectPromiseSettlementArgNodeIdsFromExecutor(
    pag: Pag,
    executorMethod: any,
    activation: ExecutionHandoffContractRecord["activation"],
): number[] {
    const cfg = executorMethod.getCfg?.();
    if (!cfg) return [];
    const sourceNodeIds: number[] = [];
    for (const stmt of cfg.getStmts()) {
        const invokeExpr = stmt?.getInvokeExpr?.();
        if (!invokeExpr || !matchesPromiseSettlementInvoke(invokeExpr, activation)) continue;
        sourceNodeIds.push(...collectInvokeArgNodeIds(pag, invokeExpr, stmt));
    }
    return dedupeNodeIds(sourceNodeIds);
}

function matchesPromiseSettlementInvoke(
    invokeExpr: any,
    activation: ExecutionHandoffContractRecord["activation"],
): boolean {
    const methodName = resolveInvokeMethodName(invokeExpr);
    if (!methodName) return false;
    if (activation === "settle(fulfilled)") return methodName === "resolve";
    if (activation === "settle(rejected)") return methodName === "reject";
    return methodName === "resolve" || methodName === "reject";
}

function isPromiseResolveRejectInvoke(
    invokeExpr: any,
    activation: ExecutionHandoffContractRecord["activation"],
): boolean {
    if (!(invokeExpr instanceof ArkStaticInvokeExpr || invokeExpr instanceof ArkInstanceInvokeExpr || invokeExpr instanceof ArkPtrInvokeExpr)) {
        return false;
    }
    const methodName = resolveInvokeMethodName(invokeExpr);
    if (activation === "settle(fulfilled)") {
        return methodName === "resolve" && isPromiseLikeInvokeText(invokeExpr);
    }
    if (activation === "settle(rejected)") {
        return methodName === "reject" && isPromiseLikeInvokeText(invokeExpr);
    }
    return (methodName === "resolve" || methodName === "reject") && isPromiseLikeInvokeText(invokeExpr);
}

function isPromiseConstructorInvoke(invokeExpr: any): boolean {
    if (!(invokeExpr instanceof ArkInstanceInvokeExpr || invokeExpr instanceof ArkPtrInvokeExpr)) {
        return false;
    }
    const methodName = resolveInvokeMethodName(invokeExpr);
    if (methodName !== "constructor") return false;
    const sigText = invokeExpr.getMethodSignature?.()?.toString?.() || "";
    const baseValue = invokeExpr instanceof ArkInstanceInvokeExpr ? invokeExpr.getBase?.() : undefined;
    const baseText = baseValue?.getType?.()?.toString?.() || baseValue?.toString?.() || "";
    return sigText.includes("Promise.constructor") || baseText.includes("Promise");
}

function isPromiseProducingInvoke(invokeExpr: any): boolean {
    return invokeExpr instanceof ArkStaticInvokeExpr
        || invokeExpr instanceof ArkInstanceInvokeExpr
        || invokeExpr instanceof ArkPtrInvokeExpr;
}

function isDeferredContinuationInvoke(invokeExpr: any): boolean {
    if (!(invokeExpr instanceof ArkInstanceInvokeExpr || invokeExpr instanceof ArkPtrInvokeExpr)) {
        return false;
    }
    const methodName = resolveInvokeMethodName(invokeExpr);
    if (methodName === "then" || methodName === "catch" || methodName === "finally") {
        return true;
    }
    const sigText = invokeExpr.getMethodSignature?.()?.toString?.() || "";
    return sigText.includes(".then()") || sigText.includes(".catch()") || sigText.includes(".finally()");
}

function isPromiseSettlementActivation(
    activation: ExecutionHandoffContractRecord["activation"],
): boolean {
    return activation === "settle(fulfilled)"
        || activation === "settle(rejected)"
        || activation === "settle(any)";
}

function isPromiseLikeInvokeText(invokeExpr: any): boolean {
    const sigText = invokeExpr?.getMethodSignature?.()?.toString?.() || "";
    const baseText = invokeExpr?.getBase?.()?.getType?.()?.toString?.() || invokeExpr?.getBase?.()?.toString?.() || "";
    return sigText.includes("Promise.resolve")
        || sigText.includes("Promise.reject")
        || baseText.includes("Promise")
        || String(baseText).toLowerCase() === "promise";
}

function collectInvokeArgNodeIds(
    pag: Pag,
    invokeExpr: any,
    anchorStmt: any,
): number[] {
    const sourceNodeIds: number[] = [];
    for (const arg of invokeExpr?.getArgs?.() || []) {
        sourceNodeIds.push(...collectNodeIds(safeGetOrCreatePagNodes(pag, arg, anchorStmt)));
    }
    return dedupeNodeIds(sourceNodeIds);
}

function resolveDeclaringMethodSignature(value: Local): string {
    return value
        .getDeclaringStmt?.()
        ?.getCfg?.()
        ?.getDeclaringMethod?.()
        ?.getSignature?.()
        ?.toString?.() || "";
}

function resolveEnvBindings(
    scene: Scene,
    pag: Pag,
    contract: ExecutionHandoffContractRecord,
): ExecutionHandoffResolvedEdgeBinding[] {
    if (contract.ports.env !== "envIn" && contract.ports.env !== "envIO") {
        return [];
    }

    const bindings: ExecutionHandoffResolvedEdgeBinding[] = [];
    const sourceMethods = contract.sourceMethods.length > 0 ? contract.sourceMethods : [contract.caller];
    const declarativeTargetField = resolveQualifiedDeclarativeFieldTriggerToken(contract.unit);

    if (declarativeTargetField) {
        const sourceNodeIds = dedupeNodeIds(
            sourceMethods.flatMap(method => collectMethodThisFieldWriteSourceNodeIds(pag, method, declarativeTargetField)),
        );
        const targetNodeIds = collectDirectThisFieldReadTargetNodeIds(pag, contract.unit, declarativeTargetField);
        if (sourceNodeIds.length > 0 && targetNodeIds.length > 0) {
            bindings.push({
                edgeType: CallEdgeType.CALL,
                sourceNodeIds,
                targetNodeIds,
            });
        }
    }

    for (const mapping of collectClosureFieldReadMappings(contract.unit)) {
        let sourceNodeIds = isPromiseObserveContract(contract)
            ? collectPromiseObserveEnvSourceNodeIds(scene, pag, contract, mapping.fieldName)
            : [];
        if (sourceNodeIds.length === 0) {
            sourceNodeIds = dedupeNodeIds(
                sourceMethods.flatMap(method => collectMethodSourceNodeIdsByName(pag, method, mapping.fieldName)),
            );
        }
        const targetNodeIds = collectNodeIds(
            safeGetOrCreatePagNodes(pag, mapping.callbackLocal, mapping.anchorStmt),
        );
        if (sourceNodeIds.length === 0 || targetNodeIds.length === 0) continue;
        bindings.push({
            edgeType: CallEdgeType.CALL,
            sourceNodeIds,
            targetNodeIds,
        });
    }

    for (const mapping of collectFreeLocalReadMappings(contract.unit)) {
        const sourceNodeIds = dedupeNodeIds(
            sourceMethods.flatMap(method => collectMethodSourceNodeIdsByName(pag, method, mapping.localName)),
        );
        const targetNodeIds = collectNodeIds(
            safeGetOrCreatePagNodes(pag, mapping.callbackLocal, mapping.anchorStmt),
        );
        if (sourceNodeIds.length === 0 || targetNodeIds.length === 0) continue;
        bindings.push({
            edgeType: CallEdgeType.CALL,
            sourceNodeIds,
            targetNodeIds,
        });
    }

    if (methodReadsDirectThisField(contract.unit)) {
        const sourceNodeIds = dedupeNodeIds(
            sourceMethods.flatMap(method => collectThisCarrierNodeIds(pag, method, contract.stmt)),
        );
        const targetNodeIds = collectThisCarrierNodeIds(pag, contract.unit, firstMethodStmt(contract.unit));
        if (!declarativeTargetField && sourceNodeIds.length > 0 && targetNodeIds.length > 0) {
            bindings.push({
                edgeType: CallEdgeType.CALL,
                sourceNodeIds,
                targetNodeIds,
            });
        }
    }

    return bindings;
}

function isPromiseObserveContract(contract: ExecutionHandoffContractRecord): boolean {
    return contract.semantics.continuationRole === "observe"
        && isPromiseSettlementActivation(contract.activation);
}

function collectPromiseObserveEnvSourceNodeIds(
    scene: Scene,
    pag: Pag,
    contract: ExecutionHandoffContractRecord,
    fieldName: string,
): number[] {
    const baseValue = contract.invokeExpr?.getBase?.();
    if (!(baseValue instanceof Local)) {
        return [];
    }
    return resolvePromiseObserveEnvSourceNodeIdsFromLocal(
        scene,
        pag,
        baseValue,
        contract.stmt,
        fieldName,
        new Set<string>(),
    );
}

function resolvePromiseObserveEnvSourceNodeIdsFromLocal(
    scene: Scene,
    pag: Pag,
    local: Local,
    anchorStmt: any,
    fieldName: string,
    visited: Set<string>,
): number[] {
    const localKey = `${resolveDeclaringMethodSignature(local)}#${local.getName?.() || ""}#${anchorStmt?.toString?.() || ""}`;
    if (visited.has(localKey)) {
        return [];
    }
    visited.add(localKey);

    const ownerMethod = anchorStmt?.getCfg?.()?.getDeclaringMethod?.()
        || local.getDeclaringStmt?.()?.getCfg?.()?.getDeclaringMethod?.();
    const declaringStmt = resolveLatestAssignStmtForLocal(ownerMethod, local, anchorStmt)
        || local.getDeclaringStmt?.();
    if (!(declaringStmt instanceof ArkAssignStmt) || declaringStmt.getLeftOp?.() !== local) {
        return [];
    }

    const rightOp = declaringStmt.getRightOp?.();
    if (isDeferredContinuationInvoke(rightOp)) {
        const localWriteSourceNodeIds = collectContinuationCaptureWriteSourceNodeIds(
            scene,
            pag,
            rightOp,
            fieldName,
        );
        if (localWriteSourceNodeIds.length > 0) {
            return localWriteSourceNodeIds;
        }
        const prevBase = (rightOp as any)?.getBase?.();
        if (prevBase instanceof Local) {
            return resolvePromiseObserveEnvSourceNodeIdsFromLocal(
                scene,
                pag,
                prevBase,
                declaringStmt,
                fieldName,
                visited,
            );
        }
        return [];
    }

    if (rightOp instanceof Local) {
        return resolvePromiseObserveEnvSourceNodeIdsFromLocal(
            scene,
            pag,
            rightOp,
            declaringStmt,
            fieldName,
            visited,
        );
    }

    return [];
}

function collectContinuationCaptureWriteSourceNodeIds(
    scene: Scene,
    pag: Pag,
    invokeExpr: any,
    fieldName: string,
): number[] {
    const sourceNodeIds: number[] = [];
    for (const arg of invokeExpr?.getArgs?.() || []) {
        for (const callbackMethod of resolveMethodsFromCallable(scene, arg)) {
            sourceNodeIds.push(
                ...collectCallbackCaptureWriteSourceNodeIds(
                    pag,
                    callbackMethod,
                    fieldName,
                ),
            );
        }
    }
    return dedupeNodeIds(sourceNodeIds);
}

function collectCallbackCaptureWriteSourceNodeIds(
    pag: Pag,
    callbackMethod: any,
    fieldName: string,
): number[] {
    const cfg = callbackMethod.getCfg?.();
    if (!cfg) return [];

    const fieldLocalNames = new Set(
        collectClosureFieldReadMappings(callbackMethod)
            .filter(mapping => mapping.fieldName === fieldName)
            .map(mapping => mapping.callbackLocal.getName?.() || ""),
    );
    const sourceNodeIds: number[] = [];

    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp?.();
        const right = stmt.getRightOp?.();

        if (left instanceof Local && fieldLocalNames.has(left.getName?.() || "")) {
            if (isClosureCarrierFieldRead(right, fieldName)) {
                continue;
            }
            sourceNodeIds.push(...collectSourceNodeIdsFromValue(pag, right, stmt));
            continue;
        }

        const writtenField = extractClosureCarrierFieldName(left);
        if (writtenField && writtenField === fieldName) {
            sourceNodeIds.push(...collectSourceNodeIdsFromValue(pag, right, stmt));
        }
    }

    return dedupeNodeIds(sourceNodeIds);
}

function collectSourceNodeIdsFromValue(
    pag: Pag,
    value: any,
    anchorStmt: any,
): number[] {
    const sourceNodeIds: number[] = [];
    for (const sourceLocal of collectOrdinaryTaintPreservingSourceLocals(value)) {
        sourceNodeIds.push(
            ...collectNodeIds(safeGetOrCreatePagNodes(pag, sourceLocal, anchorStmt)),
        );
    }
    return dedupeNodeIds(sourceNodeIds);
}

function isClosureCarrierFieldRead(
    value: any,
    fieldName: string,
): boolean {
    return extractClosureCarrierFieldName(value) === fieldName;
}

function extractClosureCarrierFieldName(
    value: any,
): string | undefined {
    if (value instanceof ClosureFieldRef) {
        return value.getFieldName?.() || undefined;
    }
    if (!(value instanceof ArkInstanceFieldRef)) {
        return undefined;
    }
    const base = value.getBase?.();
    if (!(base instanceof Local)) {
        return undefined;
    }
    const baseName = base.getName?.() || "";
    if (baseName !== "this" && !baseName.startsWith("%closures")) {
        return undefined;
    }
    return value.getFieldSignature?.().getFieldName?.() || value.getFieldName?.() || undefined;
}

function resolveCompletionBindings(
    scene: Scene,
    pag: Pag,
    contract: ExecutionHandoffContractRecord,
): ExecutionHandoffResolvedEdgeBinding[] {
    if (!(contract.stmt instanceof ArkAssignStmt)) {
        return [];
    }

    const bindings: ExecutionHandoffResolvedEdgeBinding[] = [];
    const resultNodeIds = collectNodeIds(
        safeGetOrCreatePagNodes(pag, contract.stmt.getLeftOp(), contract.stmt),
    );
    if (resultNodeIds.length === 0) {
        return bindings;
    }

    if (contract.semantics.continuationRole !== "observe") {
        for (const retStmt of contract.unit.getReturnStmt?.() || []) {
            if (!(retStmt instanceof ArkReturnStmt)) continue;
            const retValue = retStmt.getOp?.();
            if (!(retValue instanceof Local)) continue;
            const sourceNodeIds = collectNodeIds(
                safeGetOrCreatePagNodes(pag, retValue, retStmt),
            );
            if (sourceNodeIds.length === 0) continue;
            bindings.push({
                edgeType: CallEdgeType.RETURN,
                sourceNodeIds,
                targetNodeIds: resultNodeIds,
            });
        }
    }

    const baseValue = contract.invokeExpr?.getBase?.();
    if (contract.ports.preserve !== "preserve0" && baseValue instanceof Local) {
        const preserveActivations = contract.semantics.preserve.length > 0
            ? contract.semantics.preserve
            : [contract.activation];
        for (const preserveActivation of preserveActivations) {
            const sourceNodeIds = isPromiseSettlementActivation(preserveActivation)
                ? collectPromiseSettlementSourceNodeIdsForActivation(scene, pag, contract, preserveActivation)
                : collectNodeIds(safeGetOrCreatePagNodes(pag, baseValue, contract.stmt));
            if (sourceNodeIds.length === 0) {
                continue;
            }
            bindings.push({
                edgeType: CallEdgeType.CALL,
                sourceNodeIds,
                targetNodeIds: resultNodeIds,
                calleeSignatureOverride: `__handoff_preserve__:${preserveActivation}`,
                calleeMethodNameOverride: contract.unit.getName?.() || preserveActivation,
            });
        }
    }

    return bindings;
}

function collectInvokeBaseNodeIds(
    pag: Pag,
    contract: ExecutionHandoffContractRecord,
): number[] {
    const baseValue = contract.invokeExpr?.getBase?.();
    if (!(baseValue instanceof Local)) {
        return [];
    }
    return collectNodeIds(safeGetOrCreatePagNodes(pag, baseValue, contract.stmt));
}

function collectActivationSourceNodeIds(
    pag: Pag,
    contract: ExecutionHandoffContractRecord,
): number[] {
    const explicitSourceNodeIds = resolveExplicitSourceSelectorNodeIds(pag, contract, contract.activationSource);
    if (explicitSourceNodeIds.length > 0) {
        return explicitSourceNodeIds;
    }
    const sourceNodeIds: number[] = [];
    const invokeArgs = contract.invokeExpr?.getArgs?.() || [];
    const preferredArgIndexes = contract.matchingArgIndexes.length > 0
        ? contract.matchingArgIndexes
        : contract.callableArgIndexes;

    for (const argIndex of preferredArgIndexes) {
        if (argIndex < 0 || argIndex >= invokeArgs.length) continue;
        sourceNodeIds.push(...collectNodeIds(safeGetOrCreatePagNodes(pag, invokeArgs[argIndex], contract.stmt)));
    }

    if (sourceNodeIds.length === 0) {
        sourceNodeIds.push(...collectInvokeBaseNodeIds(pag, contract));
    }

    if (sourceNodeIds.length === 0) {
        const sourceMethods = contract.sourceMethods.length > 0 ? contract.sourceMethods : [contract.caller];
        for (const method of sourceMethods) {
            sourceNodeIds.push(...collectThisCarrierNodeIds(pag, method, contract.stmt));
        }
    }

    return dedupeNodeIds(sourceNodeIds);
}

function resolveExplicitSourceSelectorNodeIds(
    pag: Pag,
    contract: ExecutionHandoffContractRecord,
    selector: ExecutionHandoffContractRecord["activationSource"] | undefined,
): number[] {
    if (!selector) {
        return [];
    }

    if (selector.kind === "base") {
        return collectInvokeBaseNodeIds(pag, contract);
    }

    if (selector.kind === "result") {
        if (!(contract.stmt instanceof ArkAssignStmt)) {
            return [];
        }
        return collectNodeIds(
            safeGetOrCreatePagNodes(pag, contract.stmt.getLeftOp(), contract.stmt),
        );
    }

    if (selector.kind === "arg") {
        const invokeArgs = contract.invokeExpr?.getArgs?.() || [];
        if (selector.index < 0 || selector.index >= invokeArgs.length) {
            return [];
        }
        return collectNodeIds(
            safeGetOrCreatePagNodes(pag, invokeArgs[selector.index], contract.stmt),
        );
    }

    const sourceMethods = contract.sourceMethods.length > 0 ? contract.sourceMethods : [contract.caller];
    const sourceNodeIds: number[] = [];
    for (const method of sourceMethods) {
        sourceNodeIds.push(...collectThisCarrierNodeIds(pag, method, contract.stmt));
    }
    return dedupeNodeIds(sourceNodeIds);
}

function collectActivationTargetNodeIds(
    pag: Pag,
    unit: any,
): number[] {
    const thisNodeIds = collectThisCarrierNodeIds(pag, unit, firstMethodStmt(unit));
    if (thisNodeIds.length > 0) {
        return thisNodeIds;
    }

    const paramStmts = collectParameterAssignStmts(unit);
    for (const paramStmt of paramStmts) {
        const paramLocal = paramStmt.getLeftOp?.();
        if (!(paramLocal instanceof Local)) continue;
        const targetNodeIds = collectNodeIds(safeGetOrCreatePagNodes(pag, paramLocal, paramStmt));
        if (targetNodeIds.length > 0) {
            return targetNodeIds;
        }
    }

    const firstStmt = firstMethodStmt(unit);
    const leftOp = firstStmt?.getLeftOp?.();
    if (leftOp instanceof Local) {
        const targetNodeIds = collectNodeIds(safeGetOrCreatePagNodes(pag, leftOp, firstStmt));
        if (targetNodeIds.length > 0) {
            return targetNodeIds;
        }
    }

    return [];
}

function collectClosureFieldReadMappings(
    callbackMethod: any,
): Array<{ callbackLocal: Local; fieldName: string; anchorStmt: ArkAssignStmt }> {
    const results: Array<{ callbackLocal: Local; fieldName: string; anchorStmt: ArkAssignStmt }> = [];
    const cfg = callbackMethod.getCfg?.();
    if (!cfg) return results;

    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp?.();
        const right = stmt.getRightOp?.();
        if (!(left instanceof Local)) continue;
        if (!(right instanceof ArkInstanceFieldRef) && !(right instanceof ClosureFieldRef)) continue;

        const base = right.getBase?.();
        if (!(base instanceof Local)) continue;
        const isClosureCarrier = right instanceof ClosureFieldRef || base.getName?.().startsWith("%closures");
        if (!isClosureCarrier) continue;

        const fieldName = right instanceof ClosureFieldRef
            ? right.getFieldName?.()
            : right.getFieldSignature?.().getFieldName?.();
        if (!fieldName) continue;
        results.push({
            callbackLocal: left,
            fieldName,
            anchorStmt: stmt,
        });
    }

    return results;
}

function collectFreeLocalReadMappings(
    callbackMethod: any,
): Array<{ callbackLocal: Local; localName: string; anchorStmt: any }> {
    const results: Array<{ callbackLocal: Local; localName: string; anchorStmt: any }> = [];
    const cfg = callbackMethod.getCfg?.();
    if (!cfg) return results;

    const seen = new Set<string>();
    const maybeRecord = (value: any, anchorStmt: any): void => {
        if (!(value instanceof Local)) return;
        if (value.getName?.() === "this") return;
        if (value.getDeclaringStmt?.()) return;
        const localName = value.getName?.();
        if (!localName) return;
        const key = `${localName}#${anchorStmt?.toString?.() || ""}`;
        if (seen.has(key)) return;
        seen.add(key);
        results.push({
            callbackLocal: value,
            localName,
            anchorStmt,
        });
    };

    for (const stmt of cfg.getStmts()) {
        if (stmt instanceof ArkAssignStmt) {
            maybeRecord(stmt.getRightOp?.(), stmt);
        }
        const invokeExpr = stmt.getInvokeExpr?.();
        if (invokeExpr) {
            maybeRecord(invokeExpr.getBase?.(), stmt);
            for (const arg of invokeExpr.getArgs?.() || []) {
                maybeRecord(arg, stmt);
            }
        }
    }

    return results;
}

function methodReadsDirectThisField(method: any): boolean {
    const cfg = method.getCfg?.();
    if (!cfg) return false;
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const right = stmt.getRightOp?.();
        if (!(right instanceof ArkInstanceFieldRef)) continue;
        const base = right.getBase?.();
        if (base instanceof Local && base.getName?.() === "this") {
            return true;
        }
    }
    return false;
}

function collectMethodSourceNodeIdsByName(
    pag: Pag,
    method: any,
    localName: string,
): number[] {
    const local = resolveMethodLocalByName(method, localName);
    if (!(local instanceof Local)) {
        return [];
    }
    const anchorStmt = local.getDeclaringStmt?.() || firstMethodStmt(method);
    const nodeIds = collectNodeIds(safeGetOrCreatePagNodes(pag, local, anchorStmt));
    const extraPointToIds: number[] = [];
    for (const nodeId of nodeIds) {
        const pagNode: any = pag.getNode(nodeId);
        if (!pagNode) continue;
        for (const targetId of pagNode.getPointTo?.() || []) {
            extraPointToIds.push(targetId);
        }
    }
    return dedupeNodeIds([...nodeIds, ...extraPointToIds]);
}

function collectMethodThisFieldWriteSourceNodeIds(
    pag: Pag,
    method: any,
    fieldName: string,
): number[] {
    const cfg = method?.getCfg?.();
    if (!cfg) return [];

    const sourceNodeIds: number[] = [];
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp?.();
        if (!(left instanceof ArkInstanceFieldRef)) continue;
        const base = left.getBase?.();
        if (!(base instanceof Local) || base.getName?.() !== "this") continue;
        const writtenField = left.getFieldSignature?.().getFieldName?.() || left.getFieldName?.();
        if (writtenField !== fieldName) continue;
        sourceNodeIds.push(...collectNodeIds(safeGetOrCreatePagNodes(pag, left, stmt)));
        sourceNodeIds.push(...collectSourceNodeIdsFromValue(pag, stmt.getRightOp?.(), stmt));
    }
    return dedupeNodeIds(sourceNodeIds);
}

function collectDirectThisFieldReadTargetNodeIds(
    pag: Pag,
    method: any,
    fieldName: string,
): number[] {
    const cfg = method?.getCfg?.();
    if (!cfg) return [];

    const targetNodeIds: number[] = [];
    for (const stmt of cfg.getStmts()) {
        if (stmt instanceof ArkAssignStmt) {
            const right = stmt.getRightOp?.();
            if (matchesDirectThisFieldRead(right, fieldName)) {
                targetNodeIds.push(...collectNodeIds(safeGetOrCreatePagNodes(pag, right, stmt)));
                const left = stmt.getLeftOp?.();
                if (left instanceof Local) {
                    targetNodeIds.push(...collectNodeIds(safeGetOrCreatePagNodes(pag, left, stmt)));
                }
            }
        }

        const invokeExpr = stmt.getInvokeExpr?.();
        if (!invokeExpr) continue;
        const base = invokeExpr.getBase?.();
        if (matchesDirectThisFieldRead(base, fieldName)) {
            targetNodeIds.push(...collectNodeIds(safeGetOrCreatePagNodes(pag, base, stmt)));
        }
        for (const arg of invokeExpr.getArgs?.() || []) {
            if (matchesDirectThisFieldRead(arg, fieldName)) {
                targetNodeIds.push(...collectNodeIds(safeGetOrCreatePagNodes(pag, arg, stmt)));
            }
        }
    }

    return dedupeNodeIds(targetNodeIds);
}

function matchesDirectThisFieldRead(
    value: any,
    fieldName: string,
): boolean {
    if (!(value instanceof ArkInstanceFieldRef)) {
        return false;
    }
    const base = value.getBase?.();
    if (!(base instanceof Local) || base.getName?.() !== "this") {
        return false;
    }
    const readField = value.getFieldSignature?.().getFieldName?.() || value.getFieldName?.();
    return readField === fieldName;
}

function collectThisCarrierNodeIds(
    pag: Pag,
    method: any,
    anchorStmt?: any,
): number[] {
    const thisLocal = resolveMethodLocalByName(method, "this");
    if (!(thisLocal instanceof Local)) {
        return [];
    }

    const resolvedAnchor = anchorStmt || thisLocal.getDeclaringStmt?.() || firstMethodStmt(method);
    const localNodeIds = collectNodeIds(
        safeGetOrCreatePagNodes(pag, thisLocal, resolvedAnchor),
    );
    const objectNodeIds: number[] = [];
    for (const nodeId of localNodeIds) {
        const pagNode: any = pag.getNode(nodeId);
        if (!pagNode) continue;
        for (const targetId of pagNode.getPointTo?.() || []) {
            objectNodeIds.push(targetId);
        }
    }

    return dedupeNodeIds([...localNodeIds, ...objectNodeIds]);
}

function resolveMethodLocalByName(method: any, localName: string): Local | undefined {
    const locals = method?.getBody?.()?.getLocals?.();
    if (typeof locals?.get === "function") {
        const direct = locals.get(localName);
        if (direct instanceof Local) {
            return direct;
        }
    }

    const cfg = method?.getCfg?.();
    if (!cfg) return undefined;
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp?.();
        if (!(left instanceof Local) || left.getName?.() !== localName) continue;
        const right = stmt.getRightOp?.();
        if (localName === "this" && right instanceof ArkThisRef) {
            return left;
        }
    }

    return undefined;
}

function firstMethodStmt(method: any): any | undefined {
    const cfg = method?.getCfg?.();
    return cfg?.getStmts?.()?.[0];
}

function resolveLatestAssignStmtForLocal(
    method: any,
    local: Local,
    beforeStmt?: any,
): ArkAssignStmt | undefined {
    const cfg = method?.getCfg?.();
    if (!cfg) return undefined;
    const stmts = cfg.getStmts?.() || [];
    const beforeIndex = beforeStmt ? stmts.indexOf(beforeStmt) : -1;
    const upperBound = beforeIndex >= 0 ? beforeIndex : stmts.length - 1;
    for (let i = upperBound; i >= 0; i -= 1) {
        const stmt = stmts[i];
        if (!(stmt instanceof ArkAssignStmt)) continue;
        if (stmt.getLeftOp?.() === local) {
            return stmt;
        }
    }
    return undefined;
}

function collectNodeIds(nodes?: Map<number, number>): number[] {
    if (!nodes || nodes.size === 0) {
        return [];
    }
    return dedupeNodeIds([...nodes.values()]);
}

function dedupeNodeIds(nodeIds: number[]): number[] {
    return [...new Set(nodeIds.filter(id => Number.isFinite(id)))].sort((a, b) => a - b);
}
