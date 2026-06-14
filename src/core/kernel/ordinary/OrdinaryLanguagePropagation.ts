import { Pag, PagArrayNode, PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { Constant } from "../../../../arkanalyzer/out/src/core/base/Constant";
import { Scene } from "../../../../arkanalyzer/out/src/Scene";
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
import { ArkArrayRef, ArkCaughtExceptionRef, ArkInstanceFieldRef, ArkParameterRef, ClosureFieldRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
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
const OBJECT_LITERAL_CAPTURE_KEY_SEPARATOR = "\u0000";
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

interface ObjectLiteralCaptureCandidate {
    candidateLine: number;
    nodeIds: number[];
    captures: ObjectLiteralCapturedField[];
}

type ObjectLiteralCaptureIndex = Map<string, ObjectLiteralCaptureCandidate[]>;
interface ObjectLiteralCapturedField {
    targetFieldName: string;
    sourceFieldPath?: string[];
}

const objectLiteralCaptureIndexCache = new WeakMap<Pag, WeakMap<Map<string, any>, ObjectLiteralCaptureIndex>>();
interface CarrierCopyLikeUse {
    value: Local;
    stmt: ArkAssignStmt;
}

const defaultCarrierCopyLikeUseIndexCache: WeakMap<Pag, Map<number, CarrierCopyLikeUse[]>> = new WeakMap();
const carrierCopyLikeUseIndexCacheByClassIndex: WeakMap<Pag, WeakMap<Map<string, any>, Map<number, CarrierCopyLikeUse[]>>> = new WeakMap();

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
    source?: string,
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
            const alreadyHasThisSource = source
                ? tracker.hasSource(leftNodeId, currentCtx, source, fieldPath)
                : tracker.isTainted(leftNodeId, currentCtx, fieldPath);
            if (!alreadyHasThisSource) {
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
            const targetFieldPath = isScalarLikeLocal(value)
                ? [fieldName]
                : fieldPath[0] === fieldName
                ? [...fieldPath]
                : [fieldName, ...fieldPath];
            results.push(new TaintFact(carrierNode, source, currentCtx, targetFieldPath));
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
            const targetFieldPath = isScalarLikeLocal(value)
                ? [slotKey]
                : [slotKey, ...fieldPath];
            results.push(new TaintFact(carrierNode, source, currentCtx, targetFieldPath));
        }
    }

    return dedupFacts(results);
}

function isScalarLikeLocal(local: Local): boolean {
    return isScalarLikeTypeText(local.getType?.()?.toString?.());
}

function isScalarLikeTypeText(raw: string | undefined): boolean {
    const text = String(raw || "").trim().toLowerCase();
    if (!text) return false;
    if (text.includes("[]") || text.includes("array<") || text.includes("map<") || text.includes("set<")) {
        return false;
    }
    return text === "string"
        || text === "boolean"
        || text === "number"
        || text === "bigint"
        || text === "symbol"
        || text === "null"
        || text === "undefined"
        || text === "void"
        || text === "byte"
        || text === "short"
        || text === "int"
        || text === "long"
        || text === "float"
        || text === "double"
        || text.endsWith(".string")
        || text.includes("std.core.string");
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
    const captureIndex = getObjectLiteralCaptureIndex(pag, classBySignature);

    for (const aliasValue of collectAliasLocalsForCarrier(pag, taintedObjId, classBySignature)) {
        const aliasName = aliasValue.getName?.() || "";
        if (!aliasName) continue;
        const aliasMethodSig = getDeclaringMethodSignatureFromLocal(aliasValue);
        if (!aliasMethodSig) continue;
        const aliasLine = getDeclaringStmtLine(aliasValue.getDeclaringStmt?.());
        const captureCandidates = captureIndex.get(objectLiteralCaptureIndexKey(aliasMethodSig, aliasName)) || [];

        for (const candidate of captureCandidates) {
            if (aliasLine > 0 && candidate.candidateLine > 0 && candidate.candidateLine < aliasLine) continue;
            for (const candidateNodeId of candidate.nodeIds) {
                const carrierNode = pag.getNode(candidateNodeId) as PagNode;
                if (!carrierNode) continue;
                let hasPointTo = false;
                for (const objId of carrierNode.getPointTo()) {
                    hasPointTo = true;
                    const objNode = pag.getNode(objId) as PagNode;
                    if (!objNode) continue;
                    for (const capture of candidate.captures) {
                        const projectedFieldPath = projectCapturedObjectLiteralFieldPath(fieldPath, capture);
                        if (!projectedFieldPath) continue;
                        results.push(new TaintFact(objNode, source, currentCtx, projectedFieldPath));
                    }
                }
                if (!hasPointTo) {
                    for (const capture of candidate.captures) {
                        const projectedFieldPath = projectCapturedObjectLiteralFieldPath(fieldPath, capture);
                        if (!projectedFieldPath) continue;
                        results.push(new TaintFact(carrierNode, source, currentCtx, projectedFieldPath));
                    }
                }
            }
        }
    }

    return dedupFacts(results);
}

export function collectObjectLiteralFieldCaptureFactsFromTaintedLocal(
    taintedNode: PagNode,
    source: string,
    currentCtx: number,
    pag: Pag,
    classBySignature: Map<string, any>,
): TaintFact[] {
    const value = taintedNode.getValue?.();
    if (!(value instanceof Local)) return [];

    const aliasName = value.getName?.() || "";
    if (!aliasName) return [];
    const aliasMethodSig = getDeclaringMethodSignatureFromLocal(value);
    if (!aliasMethodSig) return [];

    const results: TaintFact[] = [];
    const aliasLine = getDeclaringStmtLine(value.getDeclaringStmt?.());
    const captureIndex = getObjectLiteralCaptureIndex(pag, classBySignature);
    const captureCandidates = captureIndex.get(objectLiteralCaptureIndexKey(aliasMethodSig, aliasName)) || [];

    for (const candidate of captureCandidates) {
        if (aliasLine > 0 && candidate.candidateLine > 0 && candidate.candidateLine < aliasLine) continue;
        for (const candidateNodeId of candidate.nodeIds) {
            const carrierNode = pag.getNode(candidateNodeId) as PagNode;
            if (!carrierNode) continue;
            let hasPointTo = false;
            for (const objId of carrierNode.getPointTo()) {
                hasPointTo = true;
                const objNode = pag.getNode(objId) as PagNode;
                if (!objNode) continue;
                for (const capture of candidate.captures) {
                    if (capture.sourceFieldPath && capture.sourceFieldPath.length > 0) continue;
                    results.push(new TaintFact(objNode, source, currentCtx, [capture.targetFieldName]));
                }
            }
            if (!hasPointTo) {
                for (const capture of candidate.captures) {
                    if (capture.sourceFieldPath && capture.sourceFieldPath.length > 0) continue;
                    results.push(new TaintFact(carrierNode, source, currentCtx, [capture.targetFieldName]));
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
    const aliasLocals = collectAliasLocalsForCarrier(pag, taintedObjId, classBySignature);
    const directValue = (pag.getNode(taintedObjId) as PagNode | undefined)?.getValue?.();
    if (directValue instanceof Local) {
        const key = localCopyLikeIdentityKey(directValue);
        if (!aliasLocals.some(local => localCopyLikeIdentityKey(local) === key)) {
            aliasLocals.push(directValue);
        }
    }

    const copyLikeUses: CarrierCopyLikeUse[] = [];
    const seenUses = new Set<string>();
    const addUse = (value: Local, stmt: ArkAssignStmt): void => {
        const key = `${localCopyLikeIdentityKey(value)}#${stmt.toString?.() || ""}`;
        if (seenUses.has(key)) return;
        seenUses.add(key);
        copyLikeUses.push({ value, stmt });
    };

    for (const value of aliasLocals) {
        for (const stmt of collectCopyLikeAssignStmtsForLocal(value)) {
            addUse(value, stmt);
        }
    }
    for (const use of collectCarrierCopyLikeUses(pag, taintedObjId, classBySignature)) {
        addUse(use.value, use.stmt);
    }

    for (const use of copyLikeUses) {
        const stmt = use.stmt;
        const value = use.value;
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

    return dedupFacts(results);
}

function collectCarrierCopyLikeUses(
    pag: Pag,
    carrierNodeId: number,
    classBySignature?: Map<string, any>,
): CarrierCopyLikeUse[] {
    const index = getCarrierCopyLikeUseIndex(pag, classBySignature);
    return index.get(carrierNodeId) || [];
}

function getCarrierCopyLikeUseIndex(
    pag: Pag,
    classBySignature?: Map<string, any>,
): Map<number, CarrierCopyLikeUse[]> {
    if (!classBySignature) {
        const cached = defaultCarrierCopyLikeUseIndexCache.get(pag);
        if (cached) return cached;
        const built = buildCarrierCopyLikeUseIndex(pag, classBySignature);
        defaultCarrierCopyLikeUseIndexCache.set(pag, built);
        return built;
    }

    let byClassIndex = carrierCopyLikeUseIndexCacheByClassIndex.get(pag);
    if (!byClassIndex) {
        byClassIndex = new WeakMap<Map<string, any>, Map<number, CarrierCopyLikeUse[]>>();
        carrierCopyLikeUseIndexCacheByClassIndex.set(pag, byClassIndex);
    }
    const cached = byClassIndex.get(classBySignature);
    if (cached) return cached;
    const built = buildCarrierCopyLikeUseIndex(pag, classBySignature);
    byClassIndex.set(classBySignature, built);
    return built;
}

function buildCarrierCopyLikeUseIndex(
    pag: Pag,
    classBySignature?: Map<string, any>,
): Map<number, CarrierCopyLikeUse[]> {
    const index = new Map<number, CarrierCopyLikeUse[]>();
    const seen = new Set<string>();
    const methodLocalIndex = new Map<string, Map<string, Local[]>>();
    for (const rawNode of pag.getNodesIter()) {
        const value = (rawNode as PagNode).getValue?.();
        if (!(value instanceof Local)) continue;
        for (const stmt of collectCopyLikeAssignStmtsForLocal(value)) {
            if (!resolveOrdinaryCopyLikeInvokeKind(stmt.getRightOp(), value)) continue;
            const carrierNodeIds = collectCarrierNodeIdsForValueAtStmt(
                pag,
                value,
                stmt,
                classBySignature,
                methodLocalIndex,
            );
            if (carrierNodeIds.length === 0) continue;
            for (const carrierNodeId of carrierNodeIds) {
                const key = `${carrierNodeId}#${localCopyLikeIdentityKey(value)}#${stmt.toString?.() || ""}`;
                if (seen.has(key)) continue;
                seen.add(key);
                if (!index.has(carrierNodeId)) {
                    index.set(carrierNodeId, []);
                }
                index.get(carrierNodeId)!.push({ value, stmt });
            }
        }
    }
    return index;
}

function localCopyLikeIdentityKey(value: Local): string {
    return `${value.getName?.() || ""}#${value.getDeclaringStmt?.()?.toString?.() || ""}`;
}

function collectCopyLikeAssignStmtsForLocal(value: Local): ArkAssignStmt[] {
    const out: ArkAssignStmt[] = [];
    const seen = new Set<any>();
    for (const stmt of value.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        if (!resolveOrdinaryCopyLikeInvokeKind(stmt.getRightOp(), value)) continue;
        if (seen.has(stmt)) continue;
        seen.add(stmt);
        out.push(stmt);
    }

    const cfg = value.getDeclaringStmt?.()?.getCfg?.();
    const stmts = cfg?.getStmts?.() || [];
    for (const stmt of stmts) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        if (!resolveOrdinaryCopyLikeInvokeKind(stmt.getRightOp(), value)) continue;
        if (seen.has(stmt)) continue;
        seen.add(stmt);
        out.push(stmt);
    }
    return out;
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

export function collectOrdinaryClosureLocalWritebackFactsFromTaintedLocal(
    taintedNode: PagNode,
    source: string,
    currentCtx: number,
    pag: Pag,
    scene: Scene,
): TaintFact[] {
    const value = taintedNode.getValue?.();
    if (!(value instanceof Local)) return [];
    const closureMethod = value.getDeclaringStmt?.()?.getCfg?.()?.getDeclaringMethod?.();
    const closureMethodName = closureMethod?.getName?.() || "";
    if (!closureMethodName.includes("$")) return [];

    const capturedFieldName = resolveClosureCapturedFieldForLocal(closureMethod, value);
    if (!capturedFieldName) return [];

    const parentMethodName = closureMethodName.slice(closureMethodName.lastIndexOf("$") + 1);
    if (!parentMethodName || parentMethodName === closureMethodName) return [];

    const closureFileKey = methodFileKey(closureMethod);
    const results: TaintFact[] = [];
    const seen = new Set<number>();
    for (const candidate of scene.getMethods()) {
        if (candidate?.getName?.() !== parentMethodName) continue;
        if (methodFileKey(candidate) !== closureFileKey) continue;
        const locals = candidate.getBody?.()?.getLocals?.();
        if (!locals) continue;
        for (const parentLocal of locals.values()) {
            if (!(parentLocal instanceof Local)) continue;
            if ((parentLocal.getName?.() || "") !== capturedFieldName) continue;
            const parentNodes = safeGetOrCreatePagNodes(pag, parentLocal, parentLocal.getDeclaringStmt?.());
            if (!parentNodes || parentNodes.size === 0) continue;
            for (const parentNodeId of parentNodes.values()) {
                if (seen.has(parentNodeId)) continue;
                seen.add(parentNodeId);
                const parentNode = pag.getNode(parentNodeId) as PagNode;
                if (!parentNode) continue;
                results.push(new TaintFact(parentNode, source, currentCtx));
            }
        }
    }

    return results;
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

function methodFileKey(method: any): string {
    const sig = method?.getSignature?.()?.toString?.() || "";
    const idx = sig.indexOf(": ");
    return idx >= 0 ? sig.slice(0, idx) : sig;
}

function resolveClosureCapturedFieldForLocal(method: any, local: Local): string | undefined {
    const localName = local.getName?.() || "";
    if (!localName) return undefined;
    const cfg = method?.getCfg?.();
    if (!cfg) return undefined;

    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof Local) || !isSameLocal(left, local)) continue;
        const right = stmt.getRightOp();
        if (right instanceof ClosureFieldRef) {
            const fieldName = right.getFieldName?.();
            if (fieldName) return fieldName;
        }
        if (right instanceof ArkInstanceFieldRef) {
            const base = right.getBase?.();
            if (base instanceof Local && base.getName?.().startsWith("%closures")) {
                const fieldName = right.getFieldSignature?.().getFieldName?.() || right.getFieldName?.();
                if (fieldName) return fieldName;
            }
        }
    }
    return undefined;
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

function getObjectLiteralCaptureIndex(pag: Pag, classBySignature: Map<string, any>): ObjectLiteralCaptureIndex {
    let byClassIndex = objectLiteralCaptureIndexCache.get(pag);
    if (!byClassIndex) {
        byClassIndex = new WeakMap<Map<string, any>, ObjectLiteralCaptureIndex>();
        objectLiteralCaptureIndexCache.set(pag, byClassIndex);
    }
    let index = byClassIndex.get(classBySignature);
    if (!index) {
        index = buildObjectLiteralCaptureIndex(pag, classBySignature);
        byClassIndex.set(classBySignature, index);
    }
    return index;
}

function buildObjectLiteralCaptureIndex(pag: Pag, classBySignature: Map<string, any>): ObjectLiteralCaptureIndex {
    const index: ObjectLiteralCaptureIndex = new Map();
    for (const rawCandidateNode of pag.getNodesIter()) {
        const candidateNode = rawCandidateNode as PagNode;
        const candidateValue = candidateNode.getValue?.();
        if (!(candidateValue instanceof Local)) continue;

        const candidateMethodSig = getDeclaringMethodSignatureFromLocal(candidateValue);
        if (!candidateMethodSig) continue;

        const candidateClassSig = resolveLocalClassSignature(candidateValue);
        if (!candidateClassSig || !isAnonymousObjectLiteralClassSignature(candidateClassSig)) continue;

        const arkClass = classBySignature.get(candidateClassSig);
        const capturedFieldMap = resolveObjectLiteralCapturedFieldMap(arkClass);
        if (capturedFieldMap.size === 0) continue;

        const candidateNodes = pag.getNodesByValue(candidateValue);
        if (!candidateNodes || candidateNodes.size === 0) continue;
        const nodeIds = [...candidateNodes.values()];
        const candidateLine = getDeclaringStmtLine(candidateValue.getDeclaringStmt?.());
        for (const [aliasName, captures] of capturedFieldMap.entries()) {
            if (!aliasName || captures.length === 0) continue;
            const key = objectLiteralCaptureIndexKey(candidateMethodSig, aliasName);
            const bucket = index.get(key) || [];
            bucket.push({
                candidateLine,
                nodeIds,
                captures,
            });
            index.set(key, bucket);
        }
    }
    return index;
}

function objectLiteralCaptureIndexKey(methodSignature: string, aliasName: string): string {
    return `${methodSignature}${OBJECT_LITERAL_CAPTURE_KEY_SEPARATOR}${aliasName}`;
}

function resolveObjectLiteralCapturedFieldMap(arkClass: any): Map<string, ObjectLiteralCapturedField[]> {
    const out = new Map<string, Map<string, ObjectLiteralCapturedField>>();
    const fields = arkClass?.getFields?.() || [];
    const add = (
        aliasName: string | undefined,
        fieldName: string | undefined,
        sourceFieldPath?: string[],
    ): void => {
        const alias = String(aliasName || "").trim();
        const field = String(fieldName || "").trim();
        if (!alias || !field) return;
        const sourcePath = sourceFieldPath?.filter(Boolean);
        const key = `${field}${OBJECT_LITERAL_CAPTURE_KEY_SEPARATOR}${sourcePath?.join(".") || ""}`;
        const current = out.get(alias) || new Map<string, ObjectLiteralCapturedField>();
        current.set(key, {
            targetFieldName: field,
            sourceFieldPath: sourcePath && sourcePath.length > 0 ? sourcePath : undefined,
        });
        out.set(alias, current);
    };
    for (const field of fields) {
        const candidateName = field?.getSignature?.()?.getFieldName?.() || field?.getName?.();
        const initializer = field?.getInitializer?.();
        const capturedSources = resolveCapturedSourcesFromInitializer(initializer, candidateName);
        if (capturedSources.length === 0
            && candidateName
            && (!Array.isArray(initializer) || initializer.length === 0)) {
            add(candidateName, candidateName);
            continue;
        }
        for (const capturedSource of capturedSources) {
            add(capturedSource.aliasName, candidateName, capturedSource.sourceFieldPath);
        }
    }
    return new Map([...out.entries()].map(([aliasName, captures]) => [aliasName, [...captures.values()]]));
}

function resolveCapturedSourcesFromInitializer(
    initializer: any,
    fieldName?: string,
): Array<{ aliasName: string; sourceFieldPath?: string[] }> {
    if (!initializer) return [];
    if (Array.isArray(initializer)) {
        return resolveCapturedSourcesFromInitializerStatements(initializer, fieldName);
    }
    if (initializer instanceof ArkAssignStmt) {
        const right = initializer.getRightOp?.();
        const fromValue = resolveCapturedSourcesFromValue(right, [initializer], new Set<string>());
        if (fromValue.length > 0) return fromValue;
        return asArray(resolveCapturedSourceFromInitializerText(String(initializer.toString?.() || "")));
    }
    const text = String(initializer.toString?.() || "").trim();
    if (!text) return [];
    return asArray(resolveCapturedSourceFromInitializerText(text));
}

function resolveCapturedSourceFromInitializerText(text: string): { aliasName: string; sourceFieldPath?: string[] } | undefined {
    const fieldRefMatch = text.match(/=\s*([%A-Za-z_$][%A-Za-z0-9_$]*)\.<[^>]*\.([A-Za-z_$][A-Za-z0-9_$]*)>/);
    if (fieldRefMatch) {
        return { aliasName: fieldRefMatch[1], sourceFieldPath: [fieldRefMatch[2]] };
    }
    const rhs = extractFirstInitializerRhsText(text);
    if (!rhs || /^['"`].*['"`]$/.test(rhs)) return undefined;
    return /^[%A-Za-z_$][%A-Za-z0-9_$]*$/.test(rhs) ? { aliasName: rhs } : undefined;
}

function resolveCapturedSourcesFromInitializerStatements(
    stmts: any[],
    fieldName?: string,
): Array<{ aliasName: string; sourceFieldPath?: string[] }> {
    const finalSources: Array<{ aliasName: string; sourceFieldPath?: string[] }> = [];
    for (const stmt of stmts) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        if (!assignsCurrentField(stmt.getLeftOp?.(), fieldName)) continue;
        finalSources.push(...resolveCapturedSourcesFromValue(stmt.getRightOp?.(), stmts, new Set<string>()));
    }
    return dedupCapturedSources(finalSources);
}

function assignsCurrentField(left: any, fieldName?: string): boolean {
    if (!(left instanceof ArkInstanceFieldRef)) return false;
    const currentField = left.getFieldSignature?.().getFieldName?.() || left.getFieldName?.();
    if (!currentField) return false;
    return !fieldName || currentField === fieldName;
}

function resolveCapturedSourcesFromValue(
    value: any,
    stmts: any[],
    visiting: Set<string>,
): Array<{ aliasName: string; sourceFieldPath?: string[] }> {
    if (!value) return [];
    if (value instanceof Local) {
        const localKey = `${value.getName?.() || ""}#${value.getDeclaringStmt?.()?.toString?.() || ""}`;
        if (visiting.has(localKey)) return [];
        visiting.add(localKey);

        const traced: Array<{ aliasName: string; sourceFieldPath?: string[] }> = [];
        let hasLocalDefinition = false;
        for (const stmt of stmts) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp?.();
            if (!(left instanceof Local) || !isSameLocal(left, value)) continue;
            hasLocalDefinition = true;
            traced.push(...resolveCapturedSourcesFromValue(stmt.getRightOp?.(), stmts, visiting));
        }
        visiting.delete(localKey);
        if (traced.length > 0) return dedupCapturedSources(traced);
        if (hasLocalDefinition) return [];

        const aliasName = value.getName?.() || "";
        return aliasName ? [{ aliasName }] : [];
    }

    if (value instanceof ArkInstanceFieldRef) {
        const base = value.getBase?.();
        const capturedFieldName = value.getFieldSignature?.().getFieldName?.() || value.getFieldName?.();
        if (base instanceof Local && capturedFieldName) {
            const aliasName = base.getName?.() || "";
            return aliasName ? [{ aliasName, sourceFieldPath: [capturedFieldName] }] : [];
        }
        return [];
    }

    if (value instanceof ArkAwaitExpr) {
        return resolveCapturedSourcesFromValue(value.getPromise?.(), stmts, visiting);
    }

    if (value instanceof ArkCastExpr
        || value instanceof ArkUnopExpr) {
        return resolveCapturedSourcesFromValue(value.getOp?.(), stmts, visiting);
    }

    if (value instanceof ArkNormalBinopExpr
        || value instanceof ArkConditionExpr
        || value instanceof ArkPhiExpr
        || value instanceof ArkArrayRef
        || value instanceof ArkStaticInvokeExpr
        || value instanceof ArkInstanceInvokeExpr
        || value instanceof ArkPtrInvokeExpr) {
        return resolveCapturedSourcesFromPropagatingUses(value, stmts, visiting);
    }

    return [];
}

function resolveCapturedSourcesFromPropagatingUses(
    value: any,
    stmts: any[],
    visiting: Set<string>,
): Array<{ aliasName: string; sourceFieldPath?: string[] }> {
    const uses = value?.getUses?.() || [];
    const sources: Array<{ aliasName: string; sourceFieldPath?: string[] }> = [];
    for (const use of uses) {
        if (use instanceof Local && !shouldPropagateAssignedValue(value, use, false)) continue;
        sources.push(...resolveCapturedSourcesFromValue(use, stmts, visiting));
    }
    return dedupCapturedSources(sources);
}

function asArray<T>(value: T | undefined): T[] {
    return value === undefined ? [] : [value];
}

function dedupCapturedSources(
    sources: Array<{ aliasName: string; sourceFieldPath?: string[] }>,
): Array<{ aliasName: string; sourceFieldPath?: string[] }> {
    const out: Array<{ aliasName: string; sourceFieldPath?: string[] }> = [];
    const seen = new Set<string>();
    for (const source of sources) {
        const aliasName = String(source.aliasName || "").trim();
        if (!aliasName) continue;
        const path = source.sourceFieldPath?.filter(Boolean);
        const key = `${aliasName}${OBJECT_LITERAL_CAPTURE_KEY_SEPARATOR}${path?.join(".") || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
            aliasName,
            sourceFieldPath: path && path.length > 0 ? path : undefined,
        });
    }
    return out;
}

function extractFirstInitializerRhsText(text: string): string {
    const afterEquals = text.includes("=") ? text.slice(text.indexOf("=") + 1).trim() : text.trim();
    const commaIndex = afterEquals.indexOf(",");
    return (commaIndex >= 0 ? afterEquals.slice(0, commaIndex) : afterEquals).trim();
}

function projectCapturedObjectLiteralFieldPath(
    sourceFieldPath: string[],
    capture: ObjectLiteralCapturedField,
): string[] | undefined {
    const requiredSource = capture.sourceFieldPath;
    if (!requiredSource || requiredSource.length === 0) {
        return [capture.targetFieldName, ...sourceFieldPath];
    }
    if (sourceFieldPath.length < requiredSource.length) return undefined;
    for (let i = 0; i < requiredSource.length; i++) {
        if (sourceFieldPath[i] !== requiredSource[i]) return undefined;
    }
    return [capture.targetFieldName, ...sourceFieldPath.slice(requiredSource.length)];
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

export function collectOrdinaryCopyLikeConsumedLocals(
    invokeExpr: ArkStaticInvokeExpr | ArkInstanceInvokeExpr | ArkPtrInvokeExpr | any,
): Local[] {
    const out: Local[] = [];
    const seen = new Set<string>();
    const addIfConsumed = (candidate: any): void => {
        if (!(candidate instanceof Local)) return;
        if (!resolveOrdinaryCopyLikeInvokeKind(invokeExpr, candidate)) return;
        const key = localCopyLikeIdentityKey(candidate);
        if (seen.has(key)) return;
        seen.add(key);
        out.push(candidate);
    };

    addIfConsumed(invokeExpr?.getBase?.());
    for (const arg of invokeExpr?.getArgs?.() || []) {
        addIfConsumed(arg);
    }
    return out;
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
