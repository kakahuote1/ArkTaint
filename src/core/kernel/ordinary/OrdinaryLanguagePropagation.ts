import { Pag, PagArrayNode, PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { Constant } from "../../../../arkanalyzer/out/src/core/base/Constant";
import {
    AbstractExpr,
    ArkAwaitExpr,
    ArkCastExpr,
    ArkConditionExpr,
    ArkInstanceInvokeExpr,
    ArkNormalBinopExpr,
    ArkPhiExpr,
    ArkPtrInvokeExpr,
    ArkStaticInvokeExpr,
    ArkUnopExpr,
} from "../../../../arkanalyzer/out/src/core/base/Expr";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { ArrayType } from "../../../../arkanalyzer/out/src/core/base/Type";
import { ArkAssignStmt, ArkThrowStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkArrayRef, ArkCaughtExceptionRef, ArkInstanceFieldRef, ArkParameterRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { TaintFact } from "../model/TaintFact";
import { TaintTracker } from "../model/TaintTracker";
import { toContainerFieldKey } from "../model/ContainerSlotKeys";
import {
    collectAliasLocalsForCarrier,
    collectCarrierNodeIdsForValueAtStmt,
} from "./OrdinaryAliasPropagation";
import { safeGetOrCreatePagNodes } from "../contracts/PagNodeResolution";

const ARRAY_ANY_SLOT = "arr:*";
const MAX_INDEX_BACKTRACE_DEPTH = 6;
type OrdinaryCopyLikeKind =
    | "stringify_result"
    | "serialized_copy"
    | "clone_copy"
    | "regex_match_array";
type OrdinaryCopyLikeSourceRole = "arg" | "base" | "arg_or_base";

interface OrdinaryCopyLikeMatchContext {
    methodName: string;
    sigStr: string;
    baseText: string;
    invokeExpr: any;
}

interface OrdinaryCopyLikeSpec {
    kind: OrdinaryCopyLikeKind;
    methodNames: string[];
    sourceRole: OrdinaryCopyLikeSourceRole;
    matches: (ctx: OrdinaryCopyLikeMatchContext) => boolean;
}

const ORDINARY_COPY_LIKE_SPECS: OrdinaryCopyLikeSpec[] = [
    {
        kind: "stringify_result",
        methodNames: ["stringify"],
        sourceRole: "arg",
        matches: ({ baseText, sigStr }) => baseText === "json" || sigStr.includes("JsonCodec.stringify"),
    },
    {
        kind: "serialized_copy",
        methodNames: ["parse"],
        sourceRole: "arg",
        matches: ({ baseText, sigStr }) => baseText === "json" || sigStr.includes("JsonCodec.parse"),
    },
    {
        kind: "clone_copy",
        methodNames: ["structuredClone"],
        sourceRole: "arg",
        matches: () => true,
    },
    {
        kind: "clone_copy",
        methodNames: ["assign"],
        sourceRole: "arg",
        matches: ({ sigStr }) => sigStr.includes("Object.assign"),
    },
    {
        kind: "clone_copy",
        methodNames: ["from"],
        sourceRole: "arg",
        matches: ({ baseText, sigStr }) => baseText === "array" || sigStr.includes("Array.from"),
    },
    {
        kind: "clone_copy",
        methodNames: ["resolve", "reject"],
        sourceRole: "arg",
        matches: ({ baseText, sigStr, methodName }) => (
            (methodName === "resolve" || methodName === "reject")
            && (baseText === "promise" || sigStr.includes("Promise.resolve") || sigStr.includes("Promise.reject"))
        ),
    },
    {
        kind: "clone_copy",
        methodNames: ["slice", "toSpliced", "toSorted", "toReversed"],
        sourceRole: "base",
        matches: ({ invokeExpr, sigStr }) => isLikelyArrayCopyLikeBase(invokeExpr, sigStr),
    },
    {
        kind: "clone_copy",
        methodNames: ["concat"],
        sourceRole: "arg_or_base",
        matches: ({ invokeExpr, sigStr }) => isLikelyArrayCopyLikeBase(invokeExpr, sigStr),
    },
    {
        kind: "clone_copy",
        methodNames: ["replace", "replaceAll"],
        sourceRole: "base",
        matches: ({ invokeExpr, sigStr }) => isLikelyStringLikeBase(invokeExpr, sigStr),
    },
    {
        kind: "regex_match_array",
        methodNames: ["match"],
        sourceRole: "base",
        matches: ({ invokeExpr, sigStr }) => isLikelyStringLikeBase(invokeExpr, sigStr),
    },
    {
        kind: "regex_match_array",
        methodNames: ["exec"],
        sourceRole: "arg",
        matches: ({ invokeExpr, sigStr }) => isLikelyRegexLikeBase(invokeExpr, sigStr),
    },
];

export function propagateOrdinaryExpressionTaint(
    value: any,
    currentCtx: number,
    tracker: TaintTracker,
    pag: Pag,
    fieldPath?: string[],
): number[] {
    const targetNodeIds: number[] = [];
    if (!(value instanceof Local)) {
        return targetNodeIds;
    }

    const local = value;
    for (const stmt of local.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const rightOp = stmt.getRightOp();
        if (!shouldPropagateAssignedValue(rightOp, local, !!(fieldPath && fieldPath.length > 0))) continue;

        const leftOp = stmt.getLeftOp();
        if (!(leftOp instanceof Local)) continue;

        const leftPagNodes = safeGetOrCreatePagNodes(pag, leftOp, stmt);
        if (!leftPagNodes || leftPagNodes.size === 0) continue;
        for (const leftNodeId of leftPagNodes.values()) {
            if (!tracker.isTainted(leftNodeId, currentCtx)) {
                targetNodeIds.push(leftNodeId);
            }
        }
    }

    return targetNodeIds;
}

export function appendOrdinaryArrayLoadIndices(
    pag: Pag,
    fieldToVarIndex: Map<string, Set<number>>,
): { arrayNodesCount: number; indexedLoads: number } {
    let arrayNodesCount = 0;
    let indexedLoads = 0;

    for (const node of pag.getNodesIter()) {
        if (!(node instanceof PagArrayNode)) continue;
        arrayNodesCount++;

        const arrayRef = node.getValue() as ArkArrayRef;
        const slotKey = toContainerFieldKey(resolveOrdinaryArraySlotName(arrayRef.getIndex()));
        const baseLocal = arrayRef.getBase();
        const baseNodesMap = pag.getNodesByValue(baseLocal);
        if (!baseNodesMap) continue;

        for (const baseNodeId of baseNodesMap.values()) {
            const baseNode = pag.getNode(baseNodeId) as PagNode;
            const loadEdges = node.getOutgoingLoadEdges();
            if (!loadEdges) continue;

            let hasPointTo = false;
            for (const objId of baseNode.getPointTo()) {
                hasPointTo = true;
                indexedLoads += indexOutgoingLoads(fieldToVarIndex, `${objId}-${slotKey}`, loadEdges);
            }
            if (!hasPointTo) {
                indexedLoads += indexOutgoingLoads(fieldToVarIndex, `${baseNodeId}-${slotKey}`, loadEdges);
            }
        }
    }

    return { arrayNodesCount, indexedLoads };
}

export function collectDirectFieldStoreFallbackFactsFromTaintedLocal(
    taintedNode: PagNode,
    source: string,
    currentCtx: number,
    pag: Pag,
    classBySignature?: Map<string, any>,
): TaintFact[] {
    const results: TaintFact[] = [];
    const value = taintedNode.getValue?.();
    if (!(value instanceof Local)) return results;

    for (const stmt of collectCandidateAssignStmts(value, taintedNode)) {
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof ArkInstanceFieldRef) || !(right instanceof Local)) continue;
        if (!isSameLocal(right, value)) continue;

        const fieldName = left.getFieldSignature?.().getFieldName?.() || left.getFieldName?.();
        if (!fieldName) continue;
        const baseCarrierIds = collectCarrierNodeIdsForValueAtStmt(
            pag,
            left.getBase(),
            stmt,
            classBySignature,
        );
        for (const carrierNodeId of baseCarrierIds) {
            const carrierNode = pag.getNode(carrierNodeId) as PagNode;
            if (!carrierNode) continue;
            results.push(new TaintFact(carrierNode, source, currentCtx, [fieldName]));
        }
    }

    return dedupFacts(results);
}

export function collectArrayStoreFactsFromTaintedLocal(
    taintedNode: PagNode,
    source: string,
    currentCtx: number,
    pag: Pag,
    classBySignature?: Map<string, any>,
): TaintFact[] {
    const results: TaintFact[] = [];
    const value = taintedNode.getValue?.();
    if (!(value instanceof Local)) return results;

    for (const stmt of collectCandidateAssignStmts(value, taintedNode)) {
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof ArkArrayRef) || !(right instanceof Local)) continue;
        if (!isSameLocal(right, value)) continue;

        const slotKey = toContainerFieldKey(resolveOrdinaryArraySlotName(left.getIndex()));
        const baseCarrierIds = collectCarrierNodeIdsForValueAtStmt(
            pag,
            left.getBase(),
            stmt,
            classBySignature,
        );
        for (const carrierNodeId of baseCarrierIds) {
            const carrierNode = pag.getNode(carrierNodeId) as PagNode;
            if (!carrierNode) continue;
            results.push(new TaintFact(carrierNode, source, currentCtx, [slotKey]));
        }
    }

    return dedupFacts(results);
}

export function collectNestedFieldStoreFactsFromTaintedLocal(
    taintedNode: PagNode,
    fieldPath: string[],
    source: string,
    currentCtx: number,
    pag: Pag,
    classBySignature?: Map<string, any>,
): TaintFact[] {
    const results: TaintFact[] = [];
    const value = taintedNode.getValue?.();
    if (!(value instanceof Local)) return results;

    for (const stmt of collectCandidateAssignStmts(value, taintedNode)) {
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof ArkInstanceFieldRef) || !(right instanceof Local)) continue;
        if (!isSameLocal(right, value)) continue;

        const fieldName = left.getFieldSignature?.().getFieldName?.() || left.getFieldName?.();
        if (!fieldName) continue;
        const baseCarrierIds = collectCarrierNodeIdsForValueAtStmt(
            pag,
            left.getBase(),
            stmt,
            classBySignature,
        );
        for (const carrierNodeId of baseCarrierIds) {
            const carrierNode = pag.getNode(carrierNodeId) as PagNode;
            if (!carrierNode) continue;
            results.push(new TaintFact(carrierNode, source, currentCtx, [fieldName, ...fieldPath]));
        }
    }

    return dedupFacts(results);
}

export function collectNestedArrayStoreFactsFromTaintedLocal(
    taintedNode: PagNode,
    fieldPath: string[],
    source: string,
    currentCtx: number,
    pag: Pag,
    classBySignature?: Map<string, any>,
): TaintFact[] {
    const results: TaintFact[] = [];
    const value = taintedNode.getValue?.();
    if (!(value instanceof Local)) return results;

    for (const stmt of collectCandidateAssignStmts(value, taintedNode)) {
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof ArkArrayRef) || !(right instanceof Local)) continue;
        if (!isSameLocal(right, value)) continue;

        const slotKey = toContainerFieldKey(resolveOrdinaryArraySlotName(left.getIndex()));
        const baseCarrierIds = collectCarrierNodeIdsForValueAtStmt(
            pag,
            left.getBase(),
            stmt,
            classBySignature,
        );
        for (const carrierNodeId of baseCarrierIds) {
            const carrierNode = pag.getNode(carrierNodeId) as PagNode;
            if (!carrierNode) continue;
            results.push(new TaintFact(carrierNode, source, currentCtx, [slotKey, ...fieldPath]));
        }
    }

    return dedupFacts(results);
}

export function collectObjectLiteralFieldCaptureFactsFromTaintedObj(
    taintedObjId: number,
    fieldPath: string[],
    source: string,
    currentCtx: number,
    pag: Pag,
    classBySignature: Map<string, any>,
): TaintFact[] {
    const results: TaintFact[] = [];

    for (const aliasValue of collectAliasLocalsForCarrier(pag, taintedObjId, classBySignature)) {
        const aliasName = aliasValue.getName?.() || "";
        if (!aliasName) continue;
        const aliasMethodSig = getDeclaringMethodSignatureFromLocal(aliasValue);
        if (!aliasMethodSig) continue;
        const aliasLine = getDeclaringStmtLine(aliasValue.getDeclaringStmt?.());

        for (const rawCandidateNode of pag.getNodesIter()) {
            const candidateNode = rawCandidateNode as PagNode;
            const candidateValue = candidateNode.getValue?.();
            if (!(candidateValue instanceof Local)) continue;
            if (candidateValue === aliasValue) continue;

            const candidateMethodSig = getDeclaringMethodSignatureFromLocal(candidateValue);
            if (!candidateMethodSig || candidateMethodSig !== aliasMethodSig) continue;

            const candidateClassSig = resolveLocalClassSignature(candidateValue);
            if (!candidateClassSig || !isAnonymousObjectLiteralClassSignature(candidateClassSig)) continue;

            const candidateLine = getDeclaringStmtLine(candidateValue.getDeclaringStmt?.());
            if (aliasLine > 0 && candidateLine > 0 && candidateLine < aliasLine) continue;

            const arkClass = classBySignature.get(candidateClassSig);
            const capturedFieldNames = resolveObjectLiteralCapturedFieldNamesForAlias(arkClass, aliasName);
            if (capturedFieldNames.length === 0) continue;

            const candidateNodes = pag.getNodesByValue(candidateValue);
            if (!candidateNodes || candidateNodes.size === 0) continue;
            for (const candidateNodeId of candidateNodes.values()) {
                const carrierNode = pag.getNode(candidateNodeId) as PagNode;
                if (!carrierNode) continue;
                let hasPointTo = false;
                for (const objId of carrierNode.getPointTo()) {
                    hasPointTo = true;
                    const objNode = pag.getNode(objId) as PagNode;
                    if (!objNode) continue;
                    for (const capturedFieldName of capturedFieldNames) {
                        results.push(new TaintFact(objNode, source, currentCtx, [capturedFieldName, ...fieldPath]));
                    }
                }
                if (!hasPointTo) {
                    for (const capturedFieldName of capturedFieldNames) {
                        results.push(new TaintFact(carrierNode, source, currentCtx, [capturedFieldName, ...fieldPath]));
                    }
                }
            }
        }
    }

    return dedupFacts(results);
}

export function collectPreciseArrayLoadNodeIdsFromTaintedObjSlot(
    objId: number,
    slot: string,
    pag: Pag,
): number[] {
    const indexKey = extractConcreteArrayIndexKey(slot);
    if (indexKey === undefined) return [];

    const sourcePaths = collectArrayElementPathKeysForObj(objId, indexKey, pag);
    if (sourcePaths.size === 0) return [];

    const results: number[] = [];
    const dedup = new Set<number>();

    for (const rawNode of pag.getNodesIter()) {
        const node = rawNode as PagNode;
        const val = node.getValue();
        if (!(val instanceof Local)) continue;

        const decl = val.getDeclaringStmt();
        if (!(decl instanceof ArkAssignStmt)) continue;
        if (decl.getLeftOp() !== val) continue;

        const loadRef = decl.getRightOp();
        if (!(loadRef instanceof ArkArrayRef)) continue;
        const loadIdxKey = extractConcreteArrayIndexKey(resolveOrdinaryArraySlotName(loadRef.getIndex()));
        if (loadIdxKey === undefined) continue;

        const loadPaths = collectArrayElementPathKeys(loadRef.getBase(), loadIdxKey);
        if (!hasPathIntersection(sourcePaths, loadPaths)) continue;

        const dstNodes = pag.getNodesByValue(val);
        if (!dstNodes) continue;
        for (const dstId of dstNodes.values()) {
            if (dedup.has(dstId)) continue;
            dedup.add(dstId);
            results.push(dstId);
        }
    }

    return results;
}

export function collectOrdinaryCopyLikeResultFactsFromTaintedObj(
    taintedObjId: number,
    fieldPath: string[],
    source: string,
    currentCtx: number,
    pag: Pag,
    classBySignature?: Map<string, any>,
): TaintFact[] {
    const results: TaintFact[] = [];
    for (const value of collectAliasLocalsForCarrier(pag, taintedObjId, classBySignature)) {
        for (const stmt of value.getUsedStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const rightOp = stmt.getRightOp();
            const kind = resolveOrdinaryCopyLikeInvokeKind(rightOp, value);
            if (!kind) continue;

            const resultNodes = safeGetOrCreatePagNodes(pag, stmt.getLeftOp(), stmt);
            if (!resultNodes || resultNodes.size === 0) continue;
            for (const resultNodeId of resultNodes.values()) {
                const resultNode = pag.getNode(resultNodeId) as PagNode;
                if (!resultNode) continue;
                if (kind === "stringify_result") {
                    results.push(new TaintFact(resultNode, source, currentCtx));
                    results.push(new TaintFact(resultNode, source, currentCtx, [...fieldPath]));
                    continue;
                }
                if (kind === "serialized_copy") {
                    results.push(new TaintFact(resultNode, source, currentCtx, [...fieldPath]));
                    continue;
                }

                let hasPointTo = false;
                for (const objId of resultNode.getPointTo()) {
                    hasPointTo = true;
                    const objNode = pag.getNode(objId) as PagNode;
                    if (!objNode) continue;
                    results.push(new TaintFact(objNode, source, currentCtx, [...fieldPath]));
                }
                if (!hasPointTo) {
                    results.push(new TaintFact(resultNode, source, currentCtx, [...fieldPath]));
                }
            }
        }
    }

    return dedupFacts(results);
}

export function collectOrdinarySerializedStringResultFactsFromTaintedLocal(
    taintedNode: PagNode,
    source: string,
    currentCtx: number,
    pag: Pag,
): TaintFact[] {
    const results: TaintFact[] = [];
    const value = taintedNode.getValue?.();
    if (!(value instanceof Local)) return results;

    for (const stmt of value.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const rightOp = stmt.getRightOp();
        if (resolveOrdinaryCopyLikeInvokeKind(rightOp, value) !== "stringify_result") continue;

        const resultNodes = safeGetOrCreatePagNodes(pag, stmt.getLeftOp(), stmt);
        if (!resultNodes || resultNodes.size === 0) continue;
        for (const resultNodeId of resultNodes.values()) {
            const resultNode = pag.getNode(resultNodeId) as PagNode;
            if (!resultNode) continue;
            results.push(new TaintFact(resultNode, source, currentCtx));
        }
    }

    return dedupFacts(results);
}

export function collectOrdinaryRegexArrayResultFactsFromTaintedLocal(
    taintedNode: PagNode,
    source: string,
    currentCtx: number,
    pag: Pag,
): TaintFact[] {
    const results: TaintFact[] = [];
    const value = taintedNode.getValue?.();
    if (!(value instanceof Local)) return results;

    const matchSlot = toContainerFieldKey(ARRAY_ANY_SLOT);
    for (const stmt of value.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const rightOp = stmt.getRightOp();
        if (resolveOrdinaryCopyLikeInvokeKind(rightOp, value) !== "regex_match_array") continue;

        const resultNodes = safeGetOrCreatePagNodes(pag, stmt.getLeftOp(), stmt);
        if (!resultNodes || resultNodes.size === 0) continue;
        for (const resultNodeId of resultNodes.values()) {
            const resultNode = pag.getNode(resultNodeId) as PagNode;
            if (!resultNode) continue;
            let hasPointTo = false;
            for (const objId of resultNode.getPointTo()) {
                hasPointTo = true;
                const objNode = pag.getNode(objId) as PagNode;
                if (!objNode) continue;
                results.push(new TaintFact(objNode, source, currentCtx, [matchSlot]));
            }
            if (!hasPointTo) {
                results.push(new TaintFact(resultNode, source, currentCtx, [matchSlot]));
            }
        }
    }

    return dedupFacts(results);
}

export function collectOrdinaryErrorMessageFactsFromTaintedLocal(
    taintedNode: PagNode,
    source: string,
    currentCtx: number,
    pag: Pag,
): TaintFact[] {
    const results: TaintFact[] = [];
    const value = taintedNode.getValue?.();
    if (!(value instanceof Local)) return results;

    for (const stmt of value.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const rightOp = stmt.getRightOp();
        if (!(rightOp instanceof ArkInstanceInvokeExpr)) continue;
        if (!isErrorConstructorInvoke(rightOp) || !hasLocalUse(rightOp, value)) continue;

        const baseLocal = rightOp.getBase?.();
        const candidateValue = baseLocal instanceof Local ? baseLocal : stmt.getLeftOp();
        const resultNodes = safeGetOrCreatePagNodes(pag, candidateValue, stmt);
        if (!resultNodes || resultNodes.size === 0) continue;

        for (const resultNodeId of resultNodes.values()) {
            const resultNode = pag.getNode(resultNodeId) as PagNode;
            if (!resultNode) continue;
            let hasPointTo = false;
            for (const objId of resultNode.getPointTo()) {
                hasPointTo = true;
                const objNode = pag.getNode(objId) as PagNode;
                if (!objNode) continue;
                results.push(new TaintFact(objNode, source, currentCtx, ["message"]));
            }
            if (!hasPointTo) {
                results.push(new TaintFact(resultNode, source, currentCtx, ["message"]));
            }
        }
    }

    return dedupFacts(results);
}

export function collectOrdinaryCaughtExceptionFieldLoadFactsFromTaintedObj(
    taintedObjId: number,
    fieldPath: string[],
    source: string,
    currentCtx: number,
    pag: Pag,
    classBySignature?: Map<string, any>,
): TaintFact[] {
    if (fieldPath.length === 0) return [];

    const fieldName = fieldPath[0];
    const remainingPath = fieldPath.length > 1 ? fieldPath.slice(1) : undefined;
    const results: TaintFact[] = [];

    for (const aliasLocal of collectAliasLocalsForCarrier(pag, taintedObjId, classBySignature)) {
        const cfg = aliasLocal.getDeclaringStmt?.()?.getCfg?.();
        if (!cfg) continue;
        const stmts = cfg.getStmts?.() || [];
        const throwIndexes = collectThrownLocalStmtIndexes(stmts, aliasLocal);
        if (throwIndexes.length === 0) continue;

        const catchLocals = collectCaughtExceptionLocals(stmts);
        if (catchLocals.length === 0) continue;

        for (const throwIndex of throwIndexes) {
            for (const catchBinding of catchLocals) {
                if (catchBinding.index < throwIndex) continue;
                for (let stmtIndex = catchBinding.index + 1; stmtIndex < stmts.length; stmtIndex++) {
                    const stmt = stmts[stmtIndex];
                    if (!(stmt instanceof ArkAssignStmt)) continue;
                    const left = stmt.getLeftOp();
                    const right = stmt.getRightOp();
                    if (!(left instanceof Local) || !(right instanceof ArkInstanceFieldRef)) continue;
                    const rightBase = right.getBase?.();
                    if (!(rightBase instanceof Local) || rightBase.getName() !== catchBinding.local.getName()) continue;

                    const rightFieldName = right.getFieldSignature?.()?.getFieldName?.() || right.getFieldName?.();
                    if (rightFieldName !== fieldName) continue;

                    const targetNodes = safeGetOrCreatePagNodes(pag, left, stmt);
                    if (!targetNodes || targetNodes.size === 0) continue;
                    for (const targetNodeId of targetNodes.values()) {
                        const targetNode = pag.getNode(targetNodeId) as PagNode;
                        if (!targetNode) continue;
                        if (remainingPath && remainingPath.length > 0) {
                            let hasPointTo = false;
                            for (const nestedObjId of targetNode.getPointTo()) {
                                hasPointTo = true;
                                const nestedObjNode = pag.getNode(nestedObjId) as PagNode;
                                if (!nestedObjNode) continue;
                                results.push(new TaintFact(nestedObjNode, source, currentCtx, [...remainingPath]));
                            }
                            if (!hasPointTo) {
                                results.push(new TaintFact(targetNode, source, currentCtx, [...remainingPath]));
                            }
                            continue;
                        }
                        results.push(new TaintFact(targetNode, source, currentCtx));
                    }
                }
            }
        }
    }

    return dedupFacts(results);
}

export function resolveOrdinaryArraySlotName(indexValue: any): string {
    const resolvedIndex = resolveIntegerLikeValue(indexValue, 0, new Set<string>());
    return resolvedIndex === undefined ? ARRAY_ANY_SLOT : `arr:${resolvedIndex}`;
}

export function collectOrdinaryTaintPreservingSourceLocals(value: any): Local[] {
    const results = new Map<string, Local>();
    const addLocal = (candidate: any): void => {
        if (!(candidate instanceof Local)) return;
        const key = `${candidate.getName?.() || ""}#${candidate.getDeclaringStmt?.()?.toString?.() || ""}`;
        if (!results.has(key)) {
            results.set(key, candidate);
        }
    };
    const addUses = (candidate: any): void => {
        const uses = candidate?.getUses?.() || [];
        for (const use of uses) {
            addLocal(use);
        }
    };

    if (value instanceof Local) {
        addLocal(value);
        return [...results.values()];
    }

    if (value instanceof ArkCastExpr
        || value instanceof ArkPhiExpr
        || value instanceof ArkAwaitExpr
        || value instanceof ArkUnopExpr
        || value instanceof ArkConditionExpr
        || value instanceof ArkNormalBinopExpr
        || value instanceof ArkArrayRef
        || value instanceof ArkInstanceFieldRef) {
        addUses(value);
        return [...results.values()];
    }

    if (value instanceof ArkStaticInvokeExpr
        || value instanceof ArkInstanceInvokeExpr
        || value instanceof ArkPtrInvokeExpr) {
        const uses = value.getUses?.() || [];
        for (const use of uses) {
            if (use instanceof Local && resolveOrdinaryCopyLikeInvokeKind(value, use)) {
                addLocal(use);
            }
        }
        return [...results.values()];
    }

    return [...results.values()];
}

export function collectOrdinaryTaintPreservingDestinationLocals(value: any): Local[] {
    const results = new Map<string, Local>();
    const addLocal = (candidate: any): void => {
        if (!(candidate instanceof Local)) return;
        const key = `${candidate.getName?.() || ""}#${candidate.getDeclaringStmt?.()?.toString?.() || ""}`;
        if (!results.has(key)) {
            results.set(key, candidate);
        }
    };
    const addUses = (candidate: any): void => {
        const uses = candidate?.getUses?.() || [];
        for (const use of uses) {
            addLocal(use);
        }
    };

    if (value instanceof Local || value instanceof ArkParameterRef) {
        addUses(value);
        return [...results.values()];
    }

    if (value instanceof ArkCastExpr
        || value instanceof ArkPhiExpr
        || value instanceof ArkAwaitExpr
        || value instanceof ArkUnopExpr
        || value instanceof ArkConditionExpr
        || value instanceof ArkNormalBinopExpr
        || value instanceof ArkArrayRef
        || value instanceof ArkInstanceFieldRef) {
        addUses(value);
        return [...results.values()];
    }

    if (value instanceof ArkStaticInvokeExpr
        || value instanceof ArkInstanceInvokeExpr
        || value instanceof ArkPtrInvokeExpr) {
        const uses = value.getUses?.() || [];
        for (const use of uses) {
            if (use instanceof Local && resolveOrdinaryCopyLikeInvokeKind(value, use)) {
                addLocal(use);
            }
        }
        return [...results.values()];
    }

    return [...results.values()];
}

function shouldPropagateAssignedValue(rightOp: any, local: Local, preserveFieldCarrierOnly: boolean): boolean {
    if (preserveFieldCarrierOnly) {
        return shouldPropagateFieldCarrier(rightOp, local);
    }
    if (rightOp instanceof Local) {
        return isSameLocal(rightOp, local);
    }

    if (rightOp instanceof ArkStaticInvokeExpr) {
        const sigStr = rightOp.getMethodSignature?.()?.toString?.() || "";
        const methodName = resolveStaticMethodName(rightOp);
        if (resolveOrdinaryCopyLikeInvokeKind(rightOp, local)) return true;
        return sigStr.includes("%unk") && !isNonPropagatingStaticMethod(methodName);
    }

    if (rightOp instanceof ArkInstanceInvokeExpr) {
        const sigStr = rightOp.getMethodSignature?.()?.toString?.() || "";
        const methodName = rightOp.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
        if (resolveOrdinaryCopyLikeInvokeKind(rightOp, local)) return true;
        if (isDeferredContinuationMethod(methodName, sigStr)) return false;
        return sigStr.includes("%unk") && !isContainerReadMethod(methodName);
    }

    if (rightOp instanceof ArkPtrInvokeExpr) {
        const sigStr = rightOp.getMethodSignature?.()?.toString?.() || "";
        const methodName = rightOp.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
        const uses = rightOp.getUses?.() || [];
        if (resolveOrdinaryCopyLikeInvokeKind(rightOp, local)) return true;
        if (isDeferredContinuationMethod(methodName, sigStr)) return false;
        return sigStr.includes("%unk") && uses.some((use: any) => isSameLocal(use, local));
    }

    if (rightOp instanceof ArkArrayRef || rightOp instanceof ArkInstanceFieldRef) {
        return hasLocalUse(rightOp, local);
    }

    if (rightOp instanceof ArkNormalBinopExpr
        || rightOp instanceof ArkConditionExpr
        || rightOp instanceof ArkCastExpr
        || rightOp instanceof ArkAwaitExpr
        || rightOp instanceof ArkUnopExpr
        || rightOp instanceof ArkPhiExpr) {
        return hasLocalUse(rightOp, local);
    }

    if (rightOp instanceof AbstractExpr) {
        return false;
    }

    return false;
}

function collectThrownLocalStmtIndexes(stmts: any[], local: Local): number[] {
    const out: number[] = [];
    for (let i = 0; i < stmts.length; i++) {
        const stmt = stmts[i];
        if (!(stmt instanceof ArkThrowStmt)) continue;
        if (isSameLocal(stmt.getOp?.(), local)) {
            out.push(i);
        }
    }
    return out;
}

function collectCaughtExceptionLocals(stmts: any[]): Array<{ index: number; local: Local }> {
    const out: Array<{ index: number; local: Local }> = [];
    for (let i = 0; i < stmts.length; i++) {
        const stmt = stmts[i];
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (left instanceof Local && right instanceof ArkCaughtExceptionRef) {
            out.push({ index: i, local: left });
        }
    }
    return out;
}

function shouldPropagateFieldCarrier(rightOp: any, local: Local): boolean {
    if (rightOp instanceof Local) {
        return isSameLocal(rightOp, local);
    }

    if (rightOp instanceof ArkStaticInvokeExpr
        || rightOp instanceof ArkInstanceInvokeExpr
        || rightOp instanceof ArkPtrInvokeExpr) {
        if (resolveOrdinaryCopyLikeInvokeKind(rightOp, local)) {
            return true;
        }
        if (rightOp instanceof ArkInstanceInvokeExpr) {
            const sigStr = rightOp.getMethodSignature?.()?.toString?.() || "";
            const methodName = rightOp.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
            if (isDeferredContinuationMethod(methodName, sigStr)) {
                return false;
            }
        }
        if (rightOp instanceof ArkPtrInvokeExpr) {
            const sigStr = rightOp.getMethodSignature?.()?.toString?.() || "";
            const methodName = rightOp.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
            if (isDeferredContinuationMethod(methodName, sigStr)) {
                return false;
            }
        }
    }

    if (rightOp instanceof ArkCastExpr
        || rightOp instanceof ArkPhiExpr
        || rightOp instanceof ArkAwaitExpr) {
        return hasLocalUse(rightOp, local);
    }

    return false;
}
function hasLocalUse(value: any, local: Local): boolean {
    const uses = value?.getUses?.() || [];
    return uses.some((use: any) => isSameLocal(use, local));
}

function isDeferredContinuationMethod(methodName: string, sigStr: string): boolean {
    if (methodName === "then" || methodName === "catch" || methodName === "finally") {
        return true;
    }
    return sigStr.includes(".then()") || sigStr.includes(".catch()") || sigStr.includes(".finally()");
}

function getDeclaringMethodSignatureFromLocal(local: Local): string | undefined {
    const declStmt = local.getDeclaringStmt?.();
    return declStmt?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.();
}

function getDeclaringStmtLine(stmt: any): number {
    return stmt?.getOriginPositionInfo?.()?.getLineNo?.() ?? -1;
}

function resolveLocalClassSignature(local: Local): string | undefined {
    const typeAny = local.getType?.() as any;
    const classSig = typeAny?.getClassSignature?.();
    const text = classSig?.toString?.() || "";
    return text || undefined;
}

function isAnonymousObjectLiteralClassSignature(classSig: string): boolean {
    return classSig.includes("%AC");
}

function resolveObjectLiteralCapturedFieldNamesForAlias(arkClass: any, aliasName: string): string[] {
    const out: string[] = [];
    const fields = arkClass?.getFields?.() || [];
    for (const field of fields) {
        const candidateName = field?.getSignature?.()?.getFieldName?.() || field?.getName?.();
        const initializer = field?.getInitializer?.();
        const capturedLocalName = resolveCapturedLocalNameFromInitializer(initializer);
        if (!capturedLocalName && candidateName === aliasName) {
            out.push(candidateName);
            continue;
        }
        if (capturedLocalName === aliasName) {
            out.push(candidateName);
        }
    }
    return [...new Set(out)];
}

function resolveCapturedLocalNameFromInitializer(initializer: any): string | undefined {
    if (!initializer) return undefined;
    if (initializer instanceof ArkAssignStmt) {
        const right = initializer.getRightOp?.();
        if (right instanceof Local) {
            return right.getName?.() || undefined;
        }
        return normalizeCapturedInitializerRhs(String(initializer.toString?.() || ""));
    }
    const text = String(initializer.toString?.() || "").trim();
    if (!text) return undefined;
    return normalizeCapturedInitializerRhs(text);
}

function normalizeCapturedInitializerRhs(text: string): string | undefined {
    const rhs = text.includes("=") ? text.slice(text.indexOf("=") + 1).trim() : text.trim();
    if (!rhs || /^['"`].*['"`]$/.test(rhs)) return undefined;
    return /^[%A-Za-z_$][%A-Za-z0-9_$]*$/.test(rhs) ? rhs : undefined;
}

function resolveStaticMethodName(expr: ArkStaticInvokeExpr): string {
    const sig = expr.getMethodSignature?.();
    const bySubSig = sig?.getMethodSubSignature?.()?.getMethodName?.() || "";
    if (bySubSig) return bySubSig;
    const sigStr = sig?.toString?.() || "";
    const fromSig = sigStr.match(/\.([A-Za-z0-9_]+)\(\)/);
    if (fromSig) return fromSig[1];
    const text = expr.toString?.() || "";
    const fromText = text.match(/\.([A-Za-z0-9_]+)\(/);
    return fromText ? fromText[1] : "";
}

function isNonPropagatingStaticMethod(methodName: string): boolean {
    return methodName === "keys";
}

function isContainerReadMethod(methodName: string): boolean {
    return methodName === "get"
        || methodName === "getFirst"
        || methodName === "at"
        || methodName === "values"
        || methodName === "keys"
        || methodName === "entries";
}

function isErrorConstructorInvoke(invokeExpr: ArkInstanceInvokeExpr): boolean {
    const methodName = invokeExpr.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
    if (methodName !== "constructor") return false;
    const sigStr = invokeExpr.getMethodSignature?.()?.toString?.() || "";
    const baseTypeText = invokeExpr.getBase?.()?.getType?.()?.toString?.() || "";
    const baseText = normalizeInvokeText(baseTypeText || invokeExpr.getBase?.()?.toString?.() || "");
    return sigStr.includes("Error.constructor")
        || sigStr.includes("@%unk/%unk: Error.constructor")
        || baseText === "error"
        || baseText.endsWith(".error")
        || hasInvokeTypeToken(baseTypeText, "Error");
}

function hasInvokeTypeToken(text: string, typeName: string): boolean {
    const normalized = String(text || "").trim();
    if (!normalized) return false;
    const escapedTypeName = typeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(^|[^A-Za-z0-9_])${escapedTypeName}(?:<[^|)]*>)?(?=$|[^A-Za-z0-9_])`);
    return pattern.test(normalized);
}

function resolveOrdinaryCopyLikeInvokeKind(
    invokeExpr: ArkStaticInvokeExpr | ArkInstanceInvokeExpr | ArkPtrInvokeExpr | any,
    local: Local,
): OrdinaryCopyLikeKind | undefined {
    const methodName = resolveInvokeMethodName(invokeExpr);
    const sigStr = invokeExpr?.getMethodSignature?.()?.toString?.() || "";
    const baseText = normalizeInvokeText(invokeExpr?.getBase?.()?.toString?.() || "");

    const ctx: OrdinaryCopyLikeMatchContext = {
        methodName,
        sigStr,
        baseText,
        invokeExpr,
    };

    for (const spec of ORDINARY_COPY_LIKE_SPECS) {
        if (!spec.methodNames.includes(methodName)) continue;
        if (!ordinaryCopyLikeConsumesLocal(spec, invokeExpr, local)) continue;
        if (!spec.matches(ctx)) continue;
        return spec.kind;
    }

    return undefined;
}

function ordinaryCopyLikeConsumesLocal(
    spec: OrdinaryCopyLikeSpec,
    invokeExpr: ArkStaticInvokeExpr | ArkInstanceInvokeExpr | ArkPtrInvokeExpr | any,
    local: Local,
): boolean {
    const args = invokeExpr?.getArgs?.() || [];
    const consumesArg = args.some((arg: any) => isSameLocal(arg, local));
    const base = invokeExpr?.getBase?.();
    const consumesBase = base instanceof Local && isSameLocal(base, local);

    if (spec.sourceRole === "arg") return consumesArg;
    if (spec.sourceRole === "base") return consumesBase;
    return consumesArg || consumesBase;
}

function resolveInvokeMethodName(invokeExpr: any): string {
    if (invokeExpr instanceof ArkStaticInvokeExpr) {
        return resolveStaticMethodName(invokeExpr);
    }
    const bySubSig = invokeExpr?.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
    if (bySubSig) return bySubSig;
    const sigStr = invokeExpr?.getMethodSignature?.()?.toString?.() || "";
    const fromSig = sigStr.match(/\.([A-Za-z0-9_]+)\(\)/);
    if (fromSig) return fromSig[1];
    const text = invokeExpr?.toString?.() || "";
    const fromText = text.match(/\.([A-Za-z0-9_]+)\(/);
    return fromText ? fromText[1] : "";
}

function normalizeInvokeText(raw: string): string {
    return raw.trim().replace(/^['"`]/, "").replace(/['"`]$/, "").toLowerCase();
}

function isLikelyArrayCopyLikeBase(invokeExpr: any, sigStr: string): boolean {
    if (sigStr.includes("Array.")) return true;
    const base = invokeExpr?.getBase?.();
    if (!(base instanceof Local)) return false;
    const baseType = base.getType?.();
    const typeText = baseType?.toString?.() || "";
    return baseType instanceof ArrayType || typeText.endsWith("[]") || typeText.includes("Array<");
}

function isLikelyStringLikeBase(invokeExpr: any, sigStr: string): boolean {
    if (sigStr.includes("String.")) return true;
    const base = invokeExpr?.getBase?.();
    const typeText = base?.getType?.()?.toString?.() || "";
    return typeText === "string"
        || typeText.includes("String")
        || typeText.includes("std.core.String");
}

function isLikelyRegexLikeBase(invokeExpr: any, sigStr: string): boolean {
    if (sigStr.includes("RegExp.exec")) return true;
    const base = invokeExpr?.getBase?.();
    const typeText = base?.getType?.()?.toString?.() || "";
    return typeText.includes("RegExp");
}

function resolveIntegerLikeValue(
    value: any,
    depth: number,
    visiting: Set<string>,
): number | undefined {
    if (depth > MAX_INDEX_BACKTRACE_DEPTH || value === undefined || value === null) {
        return undefined;
    }

    if (typeof value === "number" && Number.isInteger(value)) {
        return value;
    }

    if (value instanceof Constant) {
        const parsed = Number(String(value.toString?.() || "").trim());
        return Number.isInteger(parsed) ? parsed : undefined;
    }

    const raw = String(value?.toString?.() || "").trim();
    if (/^-?\d+$/.test(raw)) {
        return Number(raw);
    }

    if (value instanceof ArkCastExpr) {
        return resolveIntegerLikeValue(value.getOp?.(), depth + 1, visiting);
    }

    if (value instanceof Local) {
        const key = `${value.getName?.() || ""}#${value.getDeclaringStmt?.()?.toString?.() || ""}`;
        if (visiting.has(key)) return undefined;
        visiting.add(key);

        const declStmt = value.getDeclaringStmt?.();
        if (!(declStmt instanceof ArkAssignStmt) || declStmt.getLeftOp() !== value) {
            return undefined;
        }
        return resolveIntegerLikeValue(declStmt.getRightOp(), depth + 1, visiting);
    }

    if (value instanceof ArkNormalBinopExpr) {
        const left = resolveIntegerLikeValue(value.getOp1?.(), depth + 1, visiting);
        const right = resolveIntegerLikeValue(value.getOp2?.(), depth + 1, visiting);
        if (left === undefined || right === undefined) return undefined;
        switch (value.getOperator?.()) {
            case "+":
                return left + right;
            case "-":
                return left - right;
            case "*":
                return left * right;
            case "/":
                return right !== 0 && Number.isInteger(left / right) ? left / right : undefined;
            case "%":
                return right !== 0 ? left % right : undefined;
            default:
                return undefined;
        }
    }

    if (value instanceof ArkUnopExpr) {
        const operand = resolveIntegerLikeValue(value.getOp?.(), depth + 1, visiting);
        if (operand === undefined) return undefined;
        switch (value.getOperator?.()) {
            default:
                return undefined;
        }
    }

    return undefined;
}

function collectCandidateAssignStmts(value: Local, taintedNode: PagNode): ArkAssignStmt[] {
    const candidateStmts: ArkAssignStmt[] = [];
    const seen = new Set<string>();
    const addStmt = (stmt: any): void => {
        if (!(stmt instanceof ArkAssignStmt)) return;
        const key = `${stmt.getOriginPositionInfo?.()?.getLineNo?.() ?? -1}:${stmt.toString?.() || ""}`;
        if (seen.has(key)) return;
        seen.add(key);
        candidateStmts.push(stmt);
    };

    for (const stmt of value.getUsedStmts()) {
        addStmt(stmt);
    }

    const declCfg = value.getDeclaringStmt?.()?.getCfg?.();
    if (declCfg) {
        for (const stmt of declCfg.getStmts()) {
            addStmt(stmt);
        }
    }

    const nodeCfg = taintedNode.getStmt?.()?.getCfg?.();
    if (nodeCfg) {
        for (const stmt of nodeCfg.getStmts()) {
            addStmt(stmt);
        }
    }

    return candidateStmts;
}

function indexOutgoingLoads(
    fieldToVarIndex: Map<string, Set<number>>,
    key: string,
    loadEdges: Iterable<any>,
): number {
    let count = 0;
    for (const edge of loadEdges) {
        const destVarId = edge.getDstID();
        if (!fieldToVarIndex.has(key)) {
            fieldToVarIndex.set(key, new Set<number>());
        }
        fieldToVarIndex.get(key)!.add(destVarId);
        count++;
    }
    return count;
}

function dedupFacts(facts: TaintFact[]): TaintFact[] {
    const out: TaintFact[] = [];
    const seen = new Set<string>();
    for (const fact of facts) {
        if (seen.has(fact.id)) continue;
        seen.add(fact.id);
        out.push(fact);
    }
    return out;
}

function isSameLocal(a: any, b: Local): boolean {
    return a instanceof Local
        && (a === b || (a.getName?.() || "") === (b.getName?.() || ""));
}

function extractConcreteArrayIndexKey(slot: string): string | undefined {
    const matched = /^arr:(-?\d+)$/.exec(slot);
    return matched ? matched[1] : undefined;
}

function collectArrayElementPathKeysForObj(objId: number, idxKey: string, pag: Pag): Set<string> {
    const preciseKeys = new Set<string>();
    const fallbackKeys = new Set<string>();
    for (const rawNode of pag.getNodesIter()) {
        const node = rawNode as PagNode;
        const val = node.getValue();
        if (!(val instanceof Local)) continue;
        const pointToIds = [...node.getPointTo()];
        if (!pointToIds.includes(objId)) continue;
        const target = pointToIds.length === 1 ? preciseKeys : fallbackKeys;
        mergePathKeys(target, collectArrayElementPathKeys(val, idxKey));
    }
    return preciseKeys.size > 0 ? preciseKeys : fallbackKeys;
}

function collectArrayElementPathKeys(base: Local, idxKey: string): Set<string> {
    const keys = new Set<string>();
    for (const pathKey of collectArrayObjectPathKeys(base, new Set<Local>())) {
        keys.add(`${pathKey}/${idxKey}`);
    }
    return keys;
}

function collectArrayObjectPathKeys(local: Local, visiting: Set<Local>): Set<string> {
    if (visiting.has(local)) {
        return new Set([rootPathKey(local)]);
    }
    visiting.add(local);

    const keys = new Set<string>();
    const decl = local.getDeclaringStmt();

    if (decl instanceof ArkAssignStmt && decl.getLeftOp() === local) {
        const right = decl.getRightOp();
        if (right instanceof Local) {
            mergePathKeys(keys, collectArrayObjectPathKeys(right, visiting));
        } else if (right instanceof ArkArrayRef) {
            const idx = resolveIntegerLikeValue(right.getIndex(), 0, new Set<string>());
            if (idx !== undefined) {
                for (const basePath of collectArrayObjectPathKeys(right.getBase(), visiting)) {
                    keys.add(`${basePath}/${idx}`);
                }
            }
        } else {
            keys.add(rootPathKey(local));
        }
    } else {
        keys.add(rootPathKey(local));
    }

    for (const stmt of local.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof ArkArrayRef)) continue;
        if (right !== local) continue;

        const parentIdx = resolveIntegerLikeValue(left.getIndex(), 0, new Set<string>());
        if (parentIdx === undefined) continue;
        for (const basePath of collectArrayObjectPathKeys(left.getBase(), visiting)) {
            keys.add(`${basePath}/${parentIdx}`);
        }
    }

    visiting.delete(local);
    return keys;
}

function mergePathKeys(target: Set<string>, src: Set<string>): void {
    for (const key of src) target.add(key);
}

function rootPathKey(local: Local): string {
    const line = local.getDeclaringStmt()?.getOriginPositionInfo()?.getLineNo?.() ?? -1;
    const methodSig = local
        .getDeclaringStmt?.()
        ?.getCfg?.()
        ?.getDeclaringMethod?.()
        ?.getSignature?.()
        ?.toString?.() || "";
    return `${methodSig}::${local.getName()}@${line}`;
}

function hasPathIntersection(a: Set<string>, b: Set<string>): boolean {
    for (const key of a) {
        if (b.has(key)) return true;
    }
    return false;
}
