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
    ArkNewExpr,
    ArkPhiExpr,
    ArkPtrInvokeExpr,
    ArkStaticInvokeExpr,
    ArkUnopExpr,
} from "../../../../arkanalyzer/out/src/core/base/Expr";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { ArrayType } from "../../../../arkanalyzer/out/src/core/base/Type";
import { ArkAssignStmt, ArkInvokeStmt, ArkThrowStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkArrayRef, ArkCaughtExceptionRef, ArkInstanceFieldRef, ArkParameterRef, ClosureFieldRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { TaintFact } from "../model/TaintFact";
import { TaintTracker } from "../model/TaintTracker";
import { toContainerFieldKey } from "../model/ContainerSlotKeys";
import {
    collectAliasLocalsForCarrier,
    collectCarrierNodeIdsForValueAtStmt,
} from "./OrdinaryAliasPropagation";
import { materializeExactPagNodes, resolveExistingPagNodes } from "../contracts/PagNodeResolution";
import { collectOrdinaryCollectionMutationEffectsFromTaintedLocal } from "./OrdinaryArrayPropagation";

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
    targetFieldPath?: string[];
    sourceFieldPath?: string[];
}

const objectLiteralCaptureIndexCache = new WeakMap<Pag, WeakMap<Map<string, any>, ObjectLiteralCaptureIndex>>();
const closureSceneIndexCache: WeakMap<Scene, ClosureSceneIndex> = new WeakMap();
const preciseArrayLoadDestNodeIdsByPathKeyCache: WeakMap<Pag, Map<string, Set<number>>> = new WeakMap();
const arrayElementPathKeysByObjectAndIndexCache: WeakMap<Pag, Map<string, Set<string>>> = new WeakMap();

interface ClosureReadbackCandidate {
    left: Local;
    stmt: ArkAssignStmt;
}

interface ClosureSceneIndex {
    parentLocalsByKey: Map<string, Local[]>;
    closureReadsByKey: Map<string, ClosureReadbackCandidate[]>;
}
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
        matches: ({ invokeExpr, methodName }) => isPromiseCopyLikeInvoke(invokeExpr, methodName),
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

        const leftPagNodes = resolveOrCreateOrdinaryExpressionResultNodes(pag, leftOp, stmt);
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

function resolveOrCreateOrdinaryExpressionResultNodes(
    pag: Pag,
    leftOp: Local,
    stmt: ArkAssignStmt,
): Map<number, number> | undefined {
    let nodes = resolveExistingPagNodes(pag, leftOp, stmt);
    if (nodes && nodes.size > 0) {
        return nodes;
    }
    if (shouldMaterializeOrdinaryExpressionResultLocal(leftOp)) {
        nodes = materializeExactPagNodes(pag, leftOp, stmt, 0);
    }
    return nodes;
}

function shouldMaterializeOrdinaryExpressionResultLocal(value: Local): boolean {
    const name = value.getName?.() || "";
    return name.length > 0 && name !== "this";
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

export function collectFieldStoreFactsFromValue(
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

export function collectArrayElementStoreFactsFromValue(
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

export function collectNestedFieldStoreFactsFromFieldValue(
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

export function collectNestedArrayStoreFactsFromFieldValue(
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

export function collectNestedCollectionStoreFactsFromFieldValue(
    taintedNode: PagNode,
    fieldPath: string[],
    source: string,
    currentCtx: number,
    pag: Pag,
    classBySignature?: Map<string, any>,
): TaintFact[] {
    const results: TaintFact[] = [];
    const aliases = collectAliasLocalsForCarrier(pag, taintedNode.getID(), classBySignature);
    const value = taintedNode.getValue?.();
    if (value instanceof Local) {
        aliases.push(value);
    }

    const seenAlias = new Set<string>();
    for (const alias of aliases) {
        const aliasKey = localCopyLikeIdentityKey(alias);
        if (seenAlias.has(aliasKey)) continue;
        seenAlias.add(aliasKey);

        const mutation = collectOrdinaryCollectionMutationEffectsFromTaintedLocal(alias, pag);
        for (const store of mutation.slotStores) {
            const carrierNodeId = store.carrierNodeId ?? store.objId;
            const carrierNode = pag.getNode(carrierNodeId) as PagNode;
            if (!carrierNode) continue;
            results.push(new TaintFact(carrierNode, source, currentCtx, [toContainerFieldKey(store.slot), ...fieldPath]));
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

export function collectObjectLiteralFieldCaptureFactsFromObjectField(
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
        const captureCandidates = [
            ...(captureIndex.get(objectLiteralCaptureIndexKey(aliasMethodSig, aliasName)) || []),
            ...collectExactObjectLiteralCaptureCandidatesForAlias(
                pag,
                classBySignature,
                aliasValue,
                aliasName,
                aliasLine,
            ),
        ];

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

export function collectObjectLiteralFieldCaptureFactsFromValue(
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
    const captureCandidates = [
        ...(captureIndex.get(objectLiteralCaptureIndexKey(aliasMethodSig, aliasName)) || []),
        ...collectExactObjectLiteralCaptureCandidatesForAlias(
            pag,
            classBySignature,
            value,
            aliasName,
            aliasLine,
        ),
    ];

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
                    results.push(new TaintFact(objNode, source, currentCtx, captureTargetFieldPath(capture)));
                }
            }
            if (!hasPointTo) {
                for (const capture of candidate.captures) {
                    if (capture.sourceFieldPath && capture.sourceFieldPath.length > 0) continue;
                    results.push(new TaintFact(carrierNode, source, currentCtx, captureTargetFieldPath(capture)));
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
    const loadIndex = getPreciseArrayLoadDestNodeIdsByPathKey(pag);

    for (const sourcePath of sourcePaths) {
        const dstNodes = loadIndex.get(sourcePath);
        if (!dstNodes) continue;
        for (const dstId of dstNodes.values()) {
            if (dedup.has(dstId)) continue;
            dedup.add(dstId);
            results.push(dstId);
        }
    }

    return results;
}

function getPreciseArrayLoadDestNodeIdsByPathKey(pag: Pag): Map<string, Set<number>> {
    const cached = preciseArrayLoadDestNodeIdsByPathKeyCache.get(pag);
    if (cached) return cached;

    const index = new Map<string, Set<number>>();
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
        if (loadPaths.size === 0) continue;

        const dstNodes = pag.getNodesByValue(val);
        if (!dstNodes) continue;
        for (const pathKey of loadPaths) {
            let bucket = index.get(pathKey);
            if (!bucket) {
                bucket = new Set<number>();
                index.set(pathKey, bucket);
            }
            for (const dstId of dstNodes.values()) {
                bucket.add(dstId);
            }
        }
    }

    preciseArrayLoadDestNodeIdsByPathKeyCache.set(pag, index);
    return index;
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
    expandCopyLikeLocalAliases(aliasLocals);

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

        const resultNodes = resolveOrCreateCopyLikeResultNodes(pag, stmt.getLeftOp(), stmt);
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

function expandCopyLikeLocalAliases(locals: Local[]): void {
    const seen = new Set(locals.map(local => localCopyLikeIdentityKey(local)));
    const queue = [...locals];
    for (let head = 0; head < queue.length && head < 64; head++) {
        const local = queue[head];
        for (const candidate of collectImmediateLocalAliases(local)) {
            const key = localCopyLikeIdentityKey(candidate);
            if (seen.has(key)) continue;
            seen.add(key);
            locals.push(candidate);
            queue.push(candidate);
        }
    }
}

function collectImmediateLocalAliases(local: Local): Local[] {
    const out: Local[] = [];
    const push = (candidate: any): void => {
        if (!(candidate instanceof Local)) return;
        if (isSameLocal(candidate, local)) return;
        out.push(candidate);
    };

    for (const stmt of local.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (isSameLocal(right, local)) {
            push(left);
        }
        if (isSameLocal(left, local)) {
            push(right);
        }
    }

    const decl = local.getDeclaringStmt?.();
    if (decl instanceof ArkAssignStmt) {
        const left = decl.getLeftOp();
        const right = decl.getRightOp();
        if (isSameLocal(left, local)) {
            push(right);
        }
        if (isSameLocal(right, local)) {
            push(left);
        }
    }

    return out;
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

        const resultNodes = resolveOrCreateCopyLikeResultNodes(pag, stmt.getLeftOp(), stmt);
        if (!resultNodes || resultNodes.size === 0) continue;
        for (const resultNodeId of resultNodes.values()) {
            const resultNode = pag.getNode(resultNodeId) as PagNode;
            if (!resultNode) continue;
            results.push(new TaintFact(resultNode, source, currentCtx));
        }
    }

    return dedupFacts(results);
}

export function collectOrdinaryCopyLikeScalarResultFactsFromTaintedLocal(
    taintedNode: PagNode,
    source: string,
    currentCtx: number,
    pag: Pag,
    fieldPath?: string[],
): TaintFact[] {
    const results: TaintFact[] = [];
    const value = taintedNode.getValue?.();
    if (!(value instanceof Local)) return results;

    for (const stmt of collectCopyLikeAssignStmtsForLocal(value)) {
        const kind = resolveOrdinaryCopyLikeInvokeKind(stmt.getRightOp(), value);
        if (!kind || kind === "stringify_result" || kind === "regex_match_array") continue;

        const resultNodes = resolveOrCreateCopyLikeResultNodes(pag, stmt.getLeftOp(), stmt);
        if (!resultNodes || resultNodes.size === 0) continue;
        for (const resultNodeId of resultNodes.values()) {
            const resultNode = pag.getNode(resultNodeId) as PagNode;
            if (!resultNode) continue;
            results.push(new TaintFact(
                resultNode,
                source,
                currentCtx,
                fieldPath && fieldPath.length > 0 ? [...fieldPath] : undefined,
            ));
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

        const resultNodes = resolveOrCreateCopyLikeResultNodes(pag, stmt.getLeftOp(), stmt);
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

export function collectOrdinaryAwaitResultFactsFromTaintedLocal(
    taintedNode: PagNode,
    source: string,
    currentCtx: number,
    pag: Pag,
    fieldPath?: string[],
): TaintFact[] {
    const results: TaintFact[] = [];
    const value = taintedNode.getValue?.();
    if (!(value instanceof Local)) return results;

    for (const stmt of collectCandidateAssignStmts(value, taintedNode)) {
        const rightOp = stmt.getRightOp();
        if (!(rightOp instanceof ArkAwaitExpr)) continue;
        if (!isSameExactLocal(rightOp.getPromise?.(), value)) continue;

        const resultNodes = resolveOrCreateCopyLikeResultNodes(pag, stmt.getLeftOp(), stmt);
        if (!resultNodes || resultNodes.size === 0) continue;
        for (const resultNodeId of resultNodes.values()) {
            const resultNode = pag.getNode(resultNodeId) as PagNode;
            if (!resultNode) continue;
            results.push(new TaintFact(
                resultNode,
                source,
                currentCtx,
                fieldPath && fieldPath.length > 0 ? [...fieldPath] : undefined,
            ));
        }
    }

    return dedupFacts(results);
}

function resolveOrCreateCopyLikeResultNodes(
    pag: Pag,
    leftOp: any,
    stmt: ArkAssignStmt,
): Map<number, number> | undefined {
    const existing = resolveExistingPagNodes(pag, leftOp, stmt);
    if (existing && existing.size > 0) return existing;
    if (!(leftOp instanceof Local)) return undefined;
    return materializeExactPagNodes(pag, leftOp, stmt, 0);
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
        const resultNodes = resolveExistingPagNodes(pag, candidateValue, stmt);
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

                    const targetNodes = resolveExistingPagNodes(pag, left, stmt);
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
    fieldPath?: string[],
): TaintFact[] {
    const value = taintedNode.getValue?.();
    if (!(value instanceof Local)) return [];
    const closureMethod = value.getDeclaringStmt?.()?.getCfg?.()?.getDeclaringMethod?.();
    const closureMethodName = closureMethod?.getName?.() || "";
    if (!closureMethodName.includes("$")) return [];

    const capturedFieldName = resolveClosureCapturedFieldForLocal(closureMethod, value);
    if (!capturedFieldName) return [];

    const parentMethodName = resolveClosureParentMethodName(closureMethodName);
    if (!parentMethodName || parentMethodName === closureMethodName) return [];

    const closureFileKey = methodFileKey(closureMethod);
    const results: TaintFact[] = [];
    const seen = new Set<number>();
    const index = getClosureSceneIndex(scene);
    const parentLocals = index.parentLocalsByKey.get(closureIndexKey(closureFileKey, parentMethodName, capturedFieldName)) || [];
    for (const parentLocal of parentLocals) {
        let parentNodes = resolveExistingPagNodes(pag, parentLocal, parentLocal.getDeclaringStmt?.());
        if (!parentNodes || parentNodes.size === 0) {
            parentNodes = materializeExactPagNodes(pag, parentLocal, parentLocal.getDeclaringStmt?.(), currentCtx);
        }
        if (!parentNodes || parentNodes.size === 0) continue;
        for (const parentNodeId of parentNodes.values()) {
            if (seen.has(parentNodeId)) continue;
            seen.add(parentNodeId);
            const parentNode = pag.getNode(parentNodeId) as PagNode;
            if (!parentNode) continue;
            results.push(new TaintFact(parentNode, source, currentCtx, fieldPath));
        }
    }

    return results;
}

export function collectOrdinaryClosureLocalReadbackFactsFromParentLocal(
    taintedNode: PagNode,
    source: string,
    currentCtx: number,
    pag: Pag,
    scene: Scene,
    fieldPath?: string[],
): TaintFact[] {
    const value = taintedNode.getValue?.();
    if (!(value instanceof Local)) return [];
    const capturedFieldName = value.getName?.() || "";
    if (!capturedFieldName) return [];
    const parentMethod = value.getDeclaringStmt?.()?.getCfg?.()?.getDeclaringMethod?.();
    const parentMethodName = parentMethod?.getName?.() || "";
    if (!parentMethodName) return [];
    const parentFileKey = methodFileKey(parentMethod);

    const results: TaintFact[] = [];
    const seen = new Set<number>();
    const index = getClosureSceneIndex(scene);
    const reads = index.closureReadsByKey.get(closureIndexKey(parentFileKey, parentMethodName, capturedFieldName)) || [];
    for (const candidate of reads) {
        let nodes = resolveExistingPagNodes(pag, candidate.left, candidate.stmt);
        if (!nodes || nodes.size === 0) {
            nodes = materializeExactPagNodes(pag, candidate.left, candidate.stmt, currentCtx);
        }
        if (!nodes || nodes.size === 0) continue;
        for (const nodeId of nodes.values()) {
            if (seen.has(nodeId)) continue;
            seen.add(nodeId);
            const node = pag.getNode(nodeId) as PagNode;
            if (!node) continue;
            results.push(new TaintFact(node, source, currentCtx, fieldPath));
        }
    }
    return results;
}

function getClosureSceneIndex(scene: Scene): ClosureSceneIndex {
    const cached = closureSceneIndexCache.get(scene);
    if (cached) return cached;

    const index: ClosureSceneIndex = {
        parentLocalsByKey: new Map<string, Local[]>(),
        closureReadsByKey: new Map<string, ClosureReadbackCandidate[]>(),
    };

    const pushLocal = (key: string, local: Local): void => {
        const bucket = index.parentLocalsByKey.get(key) || [];
        bucket.push(local);
        index.parentLocalsByKey.set(key, bucket);
    };
    const pushRead = (key: string, candidate: ClosureReadbackCandidate): void => {
        const bucket = index.closureReadsByKey.get(key) || [];
        bucket.push(candidate);
        index.closureReadsByKey.set(key, bucket);
    };

    for (const method of scene.getMethods()) {
        const methodName = method?.getName?.() || "";
        const fileKey = methodFileKey(method);
        const locals = method?.getBody?.()?.getLocals?.();
        if (locals) {
            for (const local of locals.values()) {
                if (!(local instanceof Local)) continue;
                const localName = local.getName?.() || "";
                if (!localName) continue;
                pushLocal(closureIndexKey(fileKey, methodName, localName), local);
            }
        }

        if (!methodName.includes("$")) continue;
        const parentMethodName = resolveClosureParentMethodName(methodName);
        if (!parentMethodName || parentMethodName === methodName) continue;
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            if (!(left instanceof Local)) continue;
            const fieldName = left.getName?.() || "";
            if (!fieldName) continue;
            if (!isClosureFieldReadOf(stmt.getRightOp(), fieldName)) continue;
            pushRead(closureIndexKey(fileKey, parentMethodName, fieldName), { left, stmt });
        }
    }

    closureSceneIndexCache.set(scene, index);
    return index;
}

function closureIndexKey(fileKey: string, methodName: string, fieldName: string): string {
    return `${fileKey}\u0000${methodName}\u0000${fieldName}`;
}

function isClosureFieldReadOf(value: any, fieldName: string): boolean {
    if (value instanceof ClosureFieldRef) {
        return value.getFieldName?.() === fieldName;
    }
    if (value instanceof ArkInstanceFieldRef) {
        const base = value.getBase?.();
        if (!(base instanceof Local) || !base.getName?.().startsWith("%closures")) return false;
        const actual = value.getFieldSignature?.().getFieldName?.() || value.getFieldName?.();
        return actual === fieldName;
    }
    return false;
}

function resolveClosureParentMethodName(closureMethodName: string): string | undefined {
    const firstClosureSeparator = closureMethodName.indexOf("$");
    if (firstClosureSeparator < 0) return undefined;
    const prefix = closureMethodName.slice(0, firstClosureSeparator);
    if (!/^%AM\d+$/.test(prefix)) return undefined;
    const parentName = closureMethodName.slice(firstClosureSeparator + 1);
    return parentName || undefined;
}

function isClosureMethodForParent(candidateName: string, parentMethodName: string): boolean {
    if (!candidateName || !parentMethodName) return false;
    const suffix = `$${parentMethodName}`;
    if (!candidateName.endsWith(suffix)) return false;
    const closurePrefix = candidateName.slice(0, candidateName.length - suffix.length);
    return /^%AM\d+$/.test(closurePrefix);
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
        const capturedFieldMap = resolveObjectLiteralCapturedFieldMap(arkClass, classBySignature);
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

function collectExactObjectLiteralCaptureCandidatesForAlias(
    pag: Pag,
    classBySignature: Map<string, any>,
    aliasValue: Local,
    aliasName: string,
    aliasLine: number,
): ObjectLiteralCaptureCandidate[] {
    const method = aliasValue.getDeclaringStmt?.()?.getCfg?.()?.getDeclaringMethod?.();
    const stmts = method?.getCfg?.()?.getStmts?.() || [];
    if (stmts.length === 0) return [];

    const results: ObjectLiteralCaptureCandidate[] = [];
    const seen = new Set<string>();

    for (const stmt of stmts) {
        for (const candidateValue of collectLocalValuesFromStmt(stmt)) {
            const candidateClassSig = resolveLocalClassSignature(candidateValue);
            if (!candidateClassSig || !isAnonymousObjectLiteralClassSignature(candidateClassSig)) continue;

            const arkClass = classBySignature.get(candidateClassSig);
            const capturedFieldMap = resolveObjectLiteralCapturedFieldMap(arkClass, classBySignature);
            const captures = capturedFieldMap.get(aliasName) || [];
            if (captures.length === 0) continue;

            const candidateLine = getDeclaringStmtLine(candidateValue.getDeclaringStmt?.() || stmt);
            if (aliasLine > 0 && candidateLine > 0 && candidateLine < aliasLine) continue;

            const nodeIds = resolveOrCreateExactObjectLiteralCandidateNodeIds(pag, candidateValue, stmt);
            if (nodeIds.length === 0) continue;

            const key = `${candidateValue.getName?.() || ""}${OBJECT_LITERAL_CAPTURE_KEY_SEPARATOR}`
                + `${candidateValue.getDeclaringStmt?.()?.toString?.() || stmt.toString?.() || ""}${OBJECT_LITERAL_CAPTURE_KEY_SEPARATOR}`
                + `${captures.map(capture => `${capture.targetFieldPath?.join(".") || capture.targetFieldName}:${capture.sourceFieldPath?.join(".") || ""}`).join("|")}`;
            if (seen.has(key)) continue;
            seen.add(key);

            results.push({
                candidateLine,
                nodeIds,
                captures,
            });
        }
    }

    return results;
}

function collectLocalValuesFromStmt(stmt: any): Local[] {
    const values: Local[] = [];
    const seen = new Set<string>();
    const add = (value: any): void => {
        if (!(value instanceof Local)) return;
        const key = `${value.getName?.() || ""}${OBJECT_LITERAL_CAPTURE_KEY_SEPARATOR}${value.getDeclaringStmt?.()?.toString?.() || stmt.toString?.() || ""}`;
        if (seen.has(key)) return;
        seen.add(key);
        values.push(value);
    };

    add(stmt.getLeftOp?.());
    add(stmt.getRightOp?.());
    const invokeExpr = stmt.containsInvokeExpr?.() ? stmt.getInvokeExpr?.() : undefined;
    add(invokeExpr?.getBase?.());
    for (const arg of invokeExpr?.getArgs?.() || []) {
        add(arg);
    }
    return values;
}

function resolveOrCreateExactObjectLiteralCandidateNodeIds(
    pag: Pag,
    candidateValue: Local,
    anchorStmt: any,
): number[] {
    const out = new Set<number>();
    const existing = resolveExistingPagNodes(pag, candidateValue, anchorStmt) || pag.getNodesByValue(candidateValue);
    for (const nodeId of existing?.values?.() || []) {
        out.add(Number(nodeId));
    }
    if (out.size > 0) return [...out];

    const classSig = resolveLocalClassSignature(candidateValue);
    if (!classSig || !isAnonymousObjectLiteralClassSignature(classSig)) return [];

    const nodes = materializeExactPagNodes(pag, candidateValue, candidateValue.getDeclaringStmt?.() || anchorStmt, 0);
    for (const nodeId of nodes?.values?.() || []) {
        out.add(Number(nodeId));
    }
    return [...out];
}

function resolveObjectLiteralCapturedFieldMap(
    arkClass: any,
    classBySignature?: Map<string, any>,
): Map<string, ObjectLiteralCapturedField[]> {
    const out = new Map<string, Map<string, ObjectLiteralCapturedField>>();
    const fields = arkClass?.getFields?.() || [];
    const add = (
        aliasName: string | undefined,
        fieldName: string | undefined,
        sourceFieldPath?: string[],
        targetFieldPath?: string[],
    ): void => {
        const alias = String(aliasName || "").trim();
        const field = String(fieldName || "").trim();
        if (!alias || !field) return;
        const sourcePath = sourceFieldPath?.filter(Boolean);
        const targetPath = targetFieldPath?.filter(Boolean);
        const normalizedTargetPath = targetPath && targetPath.length > 0 ? targetPath : [field];
        const key = `${normalizedTargetPath.join(".")}${OBJECT_LITERAL_CAPTURE_KEY_SEPARATOR}${sourcePath?.join(".") || ""}`;
        const current = out.get(alias) || new Map<string, ObjectLiteralCapturedField>();
        current.set(key, {
            targetFieldName: normalizedTargetPath[0],
            targetFieldPath: normalizedTargetPath,
            sourceFieldPath: sourcePath && sourcePath.length > 0 ? sourcePath : undefined,
        });
        out.set(alias, current);
    };
    for (const field of fields) {
        const candidateName = field?.getSignature?.()?.getFieldName?.() || field?.getName?.();
        const initializer = field?.getInitializer?.();
        const capturedSources = resolveCapturedSourcesFromInitializer(initializer, candidateName, classBySignature);
        if (capturedSources.length === 0
            && candidateName
            && (!Array.isArray(initializer) || initializer.length === 0)) {
            add(candidateName, candidateName);
            continue;
        }
        for (const capturedSource of capturedSources) {
            const targetPath = capturedSource.targetFieldPath && capturedSource.targetFieldPath.length > 0
                ? [candidateName, ...capturedSource.targetFieldPath]
                : undefined;
            add(capturedSource.aliasName, candidateName, capturedSource.sourceFieldPath, targetPath);
        }
    }
    return new Map([...out.entries()].map(([aliasName, captures]) => [aliasName, [...captures.values()]]));
}

type CapturedSource = { aliasName: string; sourceFieldPath?: string[]; targetFieldPath?: string[] };

function resolveCapturedSourcesFromInitializer(
    initializer: any,
    fieldName?: string,
    classBySignature?: Map<string, any>,
): CapturedSource[] {
    if (!initializer) return [];
    if (Array.isArray(initializer)) {
        return resolveCapturedSourcesFromInitializerStatements(initializer, fieldName, classBySignature);
    }
    if (initializer instanceof ArkAssignStmt) {
        const right = initializer.getRightOp?.();
        const fromValue = resolveCapturedSourcesFromValue(right, [initializer], new Set<string>(), classBySignature);
        if (fromValue.length > 0) return fromValue;
        return asArray(resolveCapturedSourceFromInitializerText(String(initializer.toString?.() || "")));
    }
    const text = String(initializer.toString?.() || "").trim();
    if (!text) return [];
    return asArray(resolveCapturedSourceFromInitializerText(text));
}

function resolveCapturedSourceFromInitializerText(text: string): CapturedSource | undefined {
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
    classBySignature?: Map<string, any>,
): CapturedSource[] {
    const finalSources: CapturedSource[] = [];
    for (const stmt of stmts) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        if (!assignsCurrentField(stmt.getLeftOp?.(), fieldName)) continue;
        finalSources.push(...resolveCapturedSourcesFromValue(stmt.getRightOp?.(), stmts, new Set<string>(), classBySignature));
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
    classBySignature?: Map<string, any>,
): CapturedSource[] {
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
            traced.push(...resolveCapturedSourcesFromValue(stmt.getRightOp?.(), stmts, visiting, classBySignature));
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
        return resolveCapturedSourcesFromValue(value.getPromise?.(), stmts, visiting, classBySignature);
    }

    if (value instanceof ArkCastExpr
        || value instanceof ArkUnopExpr) {
        return resolveCapturedSourcesFromValue(value.getOp?.(), stmts, visiting, classBySignature);
    }

    if (value instanceof ArkNewExpr && classBySignature) {
        const typeAny = value.getType?.() as any;
        const classSig = typeAny?.getClassSignature?.()?.toString?.() || "";
        if (!classSig || !isAnonymousObjectLiteralClassSignature(classSig)) return [];
        const arkClass = classBySignature.get(classSig);
        if (!arkClass) return [];
        const nestedMap = resolveObjectLiteralCapturedFieldMap(arkClass, classBySignature);
        const out: CapturedSource[] = [];
        for (const [aliasName, captures] of nestedMap.entries()) {
            for (const capture of captures) {
                out.push({
                    aliasName,
                    sourceFieldPath: capture.sourceFieldPath ? [...capture.sourceFieldPath] : undefined,
                    targetFieldPath: captureTargetFieldPath(capture),
                });
            }
        }
        return dedupCapturedSources(out);
    }

    if (value instanceof ArkNormalBinopExpr
        || value instanceof ArkConditionExpr
        || value instanceof ArkPhiExpr
        || value instanceof ArkArrayRef
        || value instanceof ArkStaticInvokeExpr
        || value instanceof ArkInstanceInvokeExpr
        || value instanceof ArkPtrInvokeExpr) {
        return resolveCapturedSourcesFromPropagatingUses(value, stmts, visiting, classBySignature);
    }

    return [];
}

function resolveCapturedSourcesFromPropagatingUses(
    value: any,
    stmts: any[],
    visiting: Set<string>,
    classBySignature?: Map<string, any>,
): CapturedSource[] {
    const uses = value?.getUses?.() || [];
    const sources: CapturedSource[] = [];
    for (const use of uses) {
        if (use instanceof Local && !shouldPropagateAssignedValue(value, use, false)) continue;
        sources.push(...resolveCapturedSourcesFromValue(use, stmts, visiting, classBySignature));
    }
    return dedupCapturedSources(sources);
}

function asArray<T>(value: T | undefined): T[] {
    return value === undefined ? [] : [value];
}

function dedupCapturedSources(
    sources: CapturedSource[],
): CapturedSource[] {
    const out: CapturedSource[] = [];
    const seen = new Set<string>();
    for (const source of sources) {
        const aliasName = String(source.aliasName || "").trim();
        if (!aliasName) continue;
        const path = source.sourceFieldPath?.filter(Boolean);
        const targetPath = source.targetFieldPath?.filter(Boolean);
        const key = `${aliasName}${OBJECT_LITERAL_CAPTURE_KEY_SEPARATOR}${path?.join(".") || ""}${OBJECT_LITERAL_CAPTURE_KEY_SEPARATOR}${targetPath?.join(".") || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
            aliasName,
            sourceFieldPath: path && path.length > 0 ? path : undefined,
            targetFieldPath: targetPath && targetPath.length > 0 ? targetPath : undefined,
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
    const targetPath = captureTargetFieldPath(capture);
    const requiredSource = capture.sourceFieldPath;
    if (!requiredSource || requiredSource.length === 0) {
        return [...targetPath, ...sourceFieldPath];
    }
    if (sourceFieldPath.length < requiredSource.length) return undefined;
    for (let i = 0; i < requiredSource.length; i++) {
        if (sourceFieldPath[i] !== requiredSource[i]) return undefined;
    }
    return [...targetPath, ...sourceFieldPath.slice(requiredSource.length)];
}

function captureTargetFieldPath(capture: ObjectLiteralCapturedField): string[] {
    const targetPath = capture.targetFieldPath?.filter(Boolean);
    return targetPath && targetPath.length > 0 ? [...targetPath] : [capture.targetFieldName];
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
    return (!sigStr.includes("@%unk") && sigStr.includes("Error.constructor"))
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

function isPromiseCopyLikeInvoke(invokeExpr: any, methodName: string): boolean {
    if (methodName !== "resolve" && methodName !== "reject") return false;
    const declaringClassName = invokeExpr?.getMethodSignature?.()?.getDeclaringClassSignature?.()?.getClassName?.() || "";
    if (declaringClassName === "Promise") return true;
    const base = invokeExpr?.getBase?.();
    if (!(base instanceof Local)) return false;
    const baseType = base.getType?.() as any;
    const baseClassName = baseType?.getClassSignature?.()?.getClassName?.() || "";
    return baseClassName === "Promise" || base.getName?.() === "Promise";
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

function resolveInvokeExprFromStmt(stmt: any): ArkInstanceInvokeExpr | ArkStaticInvokeExpr | undefined {
    if (stmt instanceof ArkAssignStmt) {
        const rightOp = stmt.getRightOp();
        if (rightOp instanceof ArkInstanceInvokeExpr || rightOp instanceof ArkStaticInvokeExpr) return rightOp;
    }
    if (stmt instanceof ArkInvokeStmt) {
        const invokeExpr = stmt.getInvokeExpr();
        if (invokeExpr instanceof ArkInstanceInvokeExpr || invokeExpr instanceof ArkStaticInvokeExpr) return invokeExpr;
    }
    const invokeExpr = stmt?.containsInvokeExpr?.() ? stmt.getInvokeExpr?.() : undefined;
    if (invokeExpr instanceof ArkInstanceInvokeExpr || invokeExpr instanceof ArkStaticInvokeExpr) return invokeExpr;
    return undefined;
}

type NestedCollectionKind = "map" | "set" | "list" | "queue" | "stack";

function resolveNestedCollectionKind(base: Local, sig: string): NestedCollectionKind | undefined {
    if (!sig.includes("@%unk")) {
        if (sig.includes("Map.") || sig.includes("WeakMap.")) return "map";
        if (sig.includes("Set.") || sig.includes("WeakSet.")) return "set";
        const sequenceKind = resolveSequenceCollectionKindFromSignature(sig);
        if (sequenceKind) return sequenceKind;
    }
    const typeText = base.getType?.()?.toString?.()?.toLowerCase?.() || "";
    if (isCollectionTypeText(typeText, "map")) return "map";
    if (isCollectionTypeText(typeText, "set")) return "set";
    const sequenceKind = resolveSequenceCollectionKindFromTypeText(typeText);
    if (sequenceKind) return sequenceKind;
    return undefined;
}

function resolveNestedCollectionStoreSlot(
    kind: NestedCollectionKind,
    methodName: string,
    args: any[],
    value: Local,
    base: Local,
    stmt: any,
): string | undefined {
    if (kind === "map" && methodName === "set" && args.length >= 2 && isSameLocal(args[1], value)) {
        return `map:${resolveCollectionKeySlot(args[0])}`;
    }
    if (kind === "set" && methodName === "add" && args.length >= 1 && isSameLocal(args[0], value)) {
        return "set:*";
    }
    if ((kind === "list" || kind === "queue" || kind === "stack") && isSequenceCollectionAppendMethod(methodName) && args.length >= 1 && isSameLocal(args[0], value)) {
        const exactIndex = resolveExactSequenceAppendIndexAtStmt(base, stmt);
        return exactIndex === undefined ? `${kind}:*` : `${kind}:${exactIndex}`;
    }
    return undefined;
}

function resolveCollectionKeySlot(value: any): string {
    const text = resolveLiteralText(value);
    if (!text) return "*";
    return text.replace(/[:|]/g, "_");
}

function resolveLiteralText(value: any): string | undefined {
    if (value instanceof Constant) {
        return normalizeLiteralText(value.toString());
    }
    if (value instanceof Local) {
        const decl = value.getDeclaringStmt?.();
        if (decl instanceof ArkAssignStmt && decl.getLeftOp() === value) {
            return resolveLiteralText(decl.getRightOp());
        }
        const name = value.getName?.();
        return name ? normalizeLiteralText(name) : undefined;
    }
    if (value instanceof ArkCastExpr) {
        return resolveLiteralText(value.getOp?.());
    }
    const text = value?.toString?.();
    return text ? normalizeLiteralText(text) : undefined;
}

function normalizeLiteralText(text: string): string {
    return String(text || "").replace(/^['"`]/, "").replace(/['"`]$/, "");
}

function isCollectionTypeText(loweredTypeText: string, kind: "map" | "set"): boolean {
    if (!loweredTypeText) return false;
    const weakKind = `weak${kind}`;
    return loweredTypeText === kind
        || loweredTypeText === weakKind
        || hasLoweredTypeToken(loweredTypeText, kind)
        || hasLoweredTypeToken(loweredTypeText, weakKind)
        || loweredTypeText.includes(`${kind}<`)
        || loweredTypeText.includes(`${weakKind}<`)
        || loweredTypeText.endsWith(`.${kind}`)
        || loweredTypeText.endsWith(`.${weakKind}`);
}

function resolveSequenceCollectionKindFromSignature(sig: string): "list" | "queue" | "stack" | undefined {
    if (sig.includes(".Queue.") || sig.includes(".Deque.")) return "queue";
    if (sig.includes(".Stack.")) return "stack";
    if (sig.includes(".List.") || sig.includes(".ArrayList.") || sig.includes(".LinkedList.") || sig.includes(".Vector.")) return "list";
    return undefined;
}

function resolveSequenceCollectionKindFromTypeText(loweredTypeText: string): "list" | "queue" | "stack" | undefined {
    if (!loweredTypeText) return undefined;
    if (hasSequenceType(loweredTypeText, "queue") || hasSequenceType(loweredTypeText, "deque")) return "queue";
    if (hasSequenceType(loweredTypeText, "stack")) return "stack";
    if (
        hasSequenceType(loweredTypeText, "list")
        || hasSequenceType(loweredTypeText, "arraylist")
        || hasSequenceType(loweredTypeText, "linkedlist")
        || hasSequenceType(loweredTypeText, "vector")
    ) {
        return "list";
    }
    return undefined;
}

function hasSequenceType(loweredTypeText: string, token: string): boolean {
    return loweredTypeText === token
        || hasLoweredTypeToken(loweredTypeText, token)
        || loweredTypeText.includes(`${token}<`)
        || loweredTypeText.endsWith(`.${token}`);
}

function hasLoweredTypeToken(loweredTypeText: string, token: string): boolean {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9_$])${escaped}($|[^a-z0-9_$])`).test(loweredTypeText);
}

function isSequenceCollectionAppendMethod(methodName: string): boolean {
    return methodName === "add"
        || methodName === "push"
        || methodName === "pushBack"
        || methodName === "enqueue"
        || methodName === "insert";
}

function resolveExactSequenceAppendIndexAtStmt(base: Local, anchorStmt: any): number | undefined {
    if (!anchorStmt || !isDefinitelyEmptySequenceCollectionLocal(base)) return undefined;
    const cfg = anchorStmt.getCfg?.() || base.getDeclaringStmt?.()?.getCfg?.();
    const stmts = cfg?.getStmts?.();
    if (!stmts) return undefined;

    let length = 0;
    for (const stmt of stmts) {
        if (stmt === anchorStmt) return length;
        const invokeExpr = resolveInvokeExprFromStmt(stmt);
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
        if (!isSameLocal(invokeExpr.getBase?.(), base)) continue;
        if (isSequenceCollectionAppendMethod(resolveInvokeMethodName(invokeExpr))) {
            length += Math.max(1, invokeExpr.getArgs?.()?.length || 1);
        }
    }
    return undefined;
}

function isDefinitelyEmptySequenceCollectionLocal(base: Local, visiting: Set<string> = new Set<string>()): boolean {
    const key = `${base.getName?.() || ""}#${base.getDeclaringStmt?.()?.toString?.() || ""}`;
    if (visiting.has(key)) return false;
    visiting.add(key);

    const decl = base.getDeclaringStmt?.();
    if (!(decl instanceof ArkAssignStmt)) return false;
    const right = decl.getRightOp?.();
    if (right instanceof Local) {
        return isDefinitelyEmptySequenceCollectionLocal(right, visiting);
    }
    const text = String(right?.toString?.() || "");
    if (/\bnew\s+(?:List|ArrayList|LinkedList|Queue|Deque|Vector|Stack)\s*</.test(text)) return true;
    if (/\bnew\s+(?:List|ArrayList|LinkedList|Queue|Deque|Vector|Stack)\s*\(/.test(text)) return true;
    const typeText = base.getType?.()?.toString?.()?.toLowerCase?.() || "";
    return !!resolveSequenceCollectionKindFromTypeText(typeText) && /\bnew\b|%instInit|constructor/i.test(text);
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

function collectCandidateStmts(value: Local, taintedNode: PagNode): any[] {
    const candidateStmts: any[] = [];
    const seen = new Set<string>();
    const addStmt = (stmt: any): void => {
        const key = `${stmt?.constructor?.name || ""}:${stmt?.getOriginPositionInfo?.()?.getLineNo?.() ?? -1}:${stmt?.toString?.() || ""}`;
        if (seen.has(key)) return;
        seen.add(key);
        candidateStmts.push(stmt);
    };

    for (const stmt of value.getUsedStmts?.() || []) {
        addStmt(stmt);
    }

    const declCfg = value.getDeclaringStmt?.()?.getCfg?.();
    if (declCfg) {
        for (const stmt of declCfg.getStmts()) {
            if (stmtUsesValue(stmt, value)) {
                addStmt(stmt);
            }
        }
    }

    const nodeCfg = taintedNode.getStmt?.()?.getCfg?.();
    if (nodeCfg) {
        for (const stmt of nodeCfg.getStmts()) {
            if (stmtUsesValue(stmt, value)) {
                addStmt(stmt);
            }
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

function stmtUsesValue(stmt: any, value: Local): boolean {
    if (stmt instanceof ArkAssignStmt) {
        return valueUsesLocal(stmt.getLeftOp?.(), value)
            || valueUsesLocal(stmt.getRightOp?.(), value);
    }
    if (stmt instanceof ArkInvokeStmt) {
        return valueUsesLocal(stmt.getInvokeExpr?.(), value);
    }
    return valueUsesLocal(stmt, value);
}

function valueUsesLocal(candidate: any, value: Local, visiting = new Set<any>()): boolean {
    if (!candidate || visiting.has(candidate)) return false;
    if (isSameLocal(candidate, value)) return true;
    visiting.add(candidate);

    if (candidate instanceof ArkInstanceInvokeExpr) {
        if (valueUsesLocal(candidate.getBase?.(), value, visiting)) return true;
        for (const arg of candidate.getArgs?.() || []) {
            if (valueUsesLocal(arg, value, visiting)) return true;
        }
        return false;
    }
    if (candidate instanceof ArkStaticInvokeExpr) {
        for (const arg of candidate.getArgs?.() || []) {
            if (valueUsesLocal(arg, value, visiting)) return true;
        }
        return false;
    }
    if (candidate instanceof ArkArrayRef) {
        return valueUsesLocal(candidate.getBase?.(), value, visiting)
            || valueUsesLocal(candidate.getIndex?.(), value, visiting);
    }
    if (candidate instanceof ArkInstanceFieldRef) {
        return valueUsesLocal(candidate.getBase?.(), value, visiting);
    }
    if (candidate instanceof ArkNormalBinopExpr) {
        return valueUsesLocal(candidate.getOp1?.(), value, visiting)
            || valueUsesLocal(candidate.getOp2?.(), value, visiting);
    }

    for (const use of candidate.getUses?.() || []) {
        if (valueUsesLocal(use, value, visiting)) return true;
    }
    return false;
}

function isSameExactLocal(a: any, b: Local): boolean {
    if (!(a instanceof Local)) return false;
    if (a === b) return true;
    return localCopyLikeIdentityKey(a) === localCopyLikeIdentityKey(b)
        && getDeclaringMethodSignatureFromLocal(a) === getDeclaringMethodSignatureFromLocal(b);
}

function extractConcreteArrayIndexKey(slot: string): string | undefined {
    const matched = /^arr:(-?\d+)$/.exec(slot);
    return matched ? matched[1] : undefined;
}

function collectArrayElementPathKeysForObj(objId: number, idxKey: string, pag: Pag): Set<string> {
    const cacheKey = `${objId}\u0000${idxKey}`;
    let byKey = arrayElementPathKeysByObjectAndIndexCache.get(pag);
    if (!byKey) {
        byKey = new Map<string, Set<string>>();
        arrayElementPathKeysByObjectAndIndexCache.set(pag, byKey);
    }
    const cached = byKey.get(cacheKey);
    if (cached) return cached;

    const preciseKeys = new Set<string>();
    for (const rawNode of pag.getNodesIter()) {
        const node = rawNode as PagNode;
        const val = node.getValue();
        if (!(val instanceof Local)) continue;
        const pointToIds = [...node.getPointTo()];
        if (!pointToIds.includes(objId)) continue;
        if (pointToIds.length !== 1) continue;
        mergePathKeys(preciseKeys, collectArrayElementPathKeys(val, idxKey));
    }
    byKey.set(cacheKey, preciseKeys);
    return preciseKeys;
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
