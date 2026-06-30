import { ArkArrayRef, ArkInstanceFieldRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { Pag, PagArrayNode, PagInstanceFieldNode, PagNode, PagStaticFieldNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt, ArkReturnStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { Constant } from "../../../../arkanalyzer/out/src/core/base/Constant";
import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { ArkMethod } from "../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { ArkParameterRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { ArkAwaitExpr, ArkCastExpr, ArkInstanceInvokeExpr, ArkNewExpr, ArkStaticInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { TaintFact } from "../model/TaintFact";
import { TaintTracker } from "../model/TaintTracker";
import { FactPredecessorRecord } from "./PropagationTypes";
import type { CurrentnessCertificate } from "../oclfs";
import { FieldAccessIndex, FieldPropagationEngine } from "../field";
import { TaintContextManager, CallEdgeInfo, CallEdgeType } from "../context/TaintContext";
import { propagateExpressionTaint } from "./ExpressionPropagation";
import {
    isConsumableSemanticEndpointProjection,
    materializeExactPagNodes,
    projectSemanticEffectEndpoint,
} from "../contracts/PagNodeResolution";
import { CaptureEdgeInfo, ReceiverFieldBridgeInfo } from "../builders/CallEdgeMapBuilder";
import {
    collectDynamicSyntheticConstructorStores,
    SyntheticInvokeEdgeInfo,
    SyntheticConstructorStoreInfo,
    SyntheticFieldBridgeInfo,
    SyntheticStaticInitStoreInfo,
} from "../builders/SyntheticInvokeEdgeBuilder";
import { WorklistProfiler } from "../debug/WorklistProfiler";
import { TransferRule } from "../../rules/RuleSchema";
import { ConfigBasedTransferExecutor, TransferExecutionResult } from "../rules/ConfigBasedTransferExecutor";
import type { ApiEffectRuntimeIndexLike } from "../../api/effects";
import type { ModuleRuntime } from "../contracts/ModuleContract";
import type {
    InternalModuleQueryApi,
    InternalRawModuleFactEvent,
    InternalRawModuleInvokeEvent,
} from "../contracts/ModuleInternal";
import type {
    BridgeDecl,
    EnqueueFactDecl,
    EnginePluginRuleChain,
    FlowDecl,
    PropagationContributionBatch,
    SyntheticEdgeDecl,
} from "../contracts/EnginePluginActions";
import { createEmptyPropagationContributionBatch } from "../contracts/EnginePluginActions";
import type {
    CallEdgeEvent,
    MethodReachedEvent,
    TaintFlowEvent,
} from "../contracts/EnginePluginEvents";
import { fromContainerFieldKey, toContainerFieldKey } from "../model/ContainerSlotKeys";
import { getMethodBySignature } from "../contracts/MethodLookup";
import { diagnoseUnresolvedVirtualDispatch } from "../../substrate/queries/CalleeResolver";
import {
    collectAliasLocalsForCarrier,
    collectCarrierNodeIdsForValueAtStmt,
} from "../ordinary/OrdinaryAliasPropagation";
import {
    collectOrdinaryArrayConstructorEffectsFromTaintedLocal,
    collectOrdinaryArrayFromMapperCallbackParamNodeIdsFromTaintedLocal,
    collectOrdinaryArrayHigherOrderEffectsFromTaintedLocal,
    collectOrdinaryArrayHigherOrderEffectsFromTaintedSlot,
    collectOrdinaryArrayMutationEffectsFromTaintedLocal,
    collectOrdinaryCollectionLoadEffectsFromTaintedSlot,
    collectOrdinaryCollectionMutationEffectsFromTaintedLocal,
    collectOrdinaryPromiseAggregateEffectsFromArraySlot,
    collectOrdinaryPromiseThenCallbackParamNodeIdsFromTaintedLocal,
    collectOrdinaryStringSplitEffectsFromTaintedLocal,
    collectPreciseArrayLoadNodeIdsFromTaintedLocal,
    isOrdinaryCollectionSlotTaintLiveAtStmt,
} from "../ordinary/OrdinaryArrayPropagation";
import {
    collectObjectLiteralFieldCaptureFactsFromObjectField,
    collectObjectLiteralFieldCaptureFactsFromValue,
    collectOrdinaryClosureLocalReadbackFactsFromParentLocal,
    collectOrdinaryClosureLocalWritebackFactsFromTaintedLocal,
    collectOrdinaryAwaitResultFactsFromTaintedLocal,
    collectOrdinaryTaintPreservingDestinationLocals,
    collectOrdinaryErrorMessageFactsFromTaintedLocal,
    collectOrdinaryCopyLikeResultFactsFromTaintedObj,
    collectOrdinaryCopyLikeScalarResultFactsFromTaintedLocal,
    collectOrdinaryRegexArrayResultFactsFromTaintedLocal,
    collectOrdinarySerializedStringResultFactsFromTaintedLocal,
    resolveOrdinaryArraySlotName,
} from "../ordinary/OrdinaryLanguagePropagation";
import {
    collectOrdinaryModuleImportBindingFactsFromTaintedLocal,
    buildOrdinarySharedStateIndex,
    collectOrdinaryModuleStateFactsFromTaintedLocal,
    collectOrdinaryStaticSharedStateFactsFromTaintedNode,
} from "../ordinary/OrdinarySharedStatePropagation";
import {
    buildClassSignatureIndex,
    buildUnresolvedThisFieldLoadNodeIdsByFieldAndFile,
    extractFilePathFromMethodSignature,
    isNodeAllowedByReachability,
    normalizeSharedStateContext,
    resolveDeclaringMethodSignature,
    resolveMethodSignatureByNode,
    resolveObjectClassSignatureByNode,
} from "./WorklistReachabilitySupport";
import {
    findStoreAnchorStmtForTaintedValue,
    propagateArrayElementLoads,
    propagateCapturedFieldWrites,
    propagateObjectFromEntriesFieldStoresByObj,
    propagateQueryResultContainerFactsByObj,
    propagateReflectSetFieldStores,
    propagateRestArrayParam,
} from "./WorklistFieldPropagation";
import { TraceGraphRecorder } from "../../trace/TraceGraph";

export interface WorklistSolverDeps {
    scene: Scene;
    pag: Pag;
    tracker: TaintTracker;
    ctxManager: TaintContextManager;
    callEdgeMap: Map<string, CallEdgeInfo>;
    receiverFieldBridgeMap: Map<number, ReceiverFieldBridgeInfo[]>;
    captureEdgeMap: Map<number, CaptureEdgeInfo[]>;
    syntheticInvokeEdgeMap: Map<number, SyntheticInvokeEdgeInfo[]>;
    syntheticConstructorStoreMap: Map<number, SyntheticConstructorStoreInfo[]>;
    syntheticStaticInitStoreMap: Map<number, SyntheticStaticInitStoreInfo[]>;
    syntheticFieldBridgeMap: Map<string, SyntheticFieldBridgeInfo[]>;
    ensureCaptureEdgesForNode?: (nodeId: number) => CaptureEdgeInfo[] | undefined;
    ensureSyntheticInvokeEdgesForNode?: (nodeId: number) => SyntheticInvokeEdgeInfo[] | undefined;
    fieldToVarIndex: Map<string, Set<number>>;
    transferRules?: TransferRule[];
    apiEffectRuntimeIndex?: ApiEffectRuntimeIndexLike;
    onTransferRuleHit?: (event: TransferExecutionResult) => void;
    getInitialRuleChainForFact?: (fact: TaintFact) => FactRuleChain;
    onFactRuleChain?: (factId: string, chain: FactRuleChain) => void;
    profiler?: WorklistProfiler;
    traceGraph?: TraceGraphRecorder;
    allowedMethodSignatures?: Set<string>;
    moduleRuntime: ModuleRuntime;
    moduleQueries: InternalModuleQueryApi;
    onFactObserved?: (fact: TaintFact) => void;
    onFactPredecessor?: (record: FactPredecessorRecord) => void;
    onCallEdge?: (event: CallEdgeEvent) => PropagationContributionBatch;
    onTaintFlow?: (event: TaintFlowEvent) => PropagationContributionBatch;
    onMethodReached?: (event: MethodReachedEvent) => PropagationContributionBatch;
    budget?: WorklistBudget;
    log: (msg: string) => void;
    progress?: (msg: string) => void;
}

export interface FactRuleChain {
    sourceRuleId?: string;
    transferRuleIds: string[];
}

export interface WorklistBudget {
    maxDequeues?: number;
    maxVisited?: number;
    maxElapsedMs?: number;
    onTruncated?: (event: WorklistBudgetTruncation) => void;
}

export interface WorklistBudgetTruncation {
    reason: string;
    queueHead: number;
    queueLength: number;
    visitedCount: number;
    elapsedMs: number;
}

interface CanonicalModuleInvokeSite {
    stmt: any;
    invokeExpr: any;
    callSignature: string;
    methodName: string;
    declaringClassName: string;
    canonicalApiId: string;
    occurrenceId: string;
    rawOccurrenceId: string;
    semanticEffectSites: ReturnType<ApiEffectRuntimeIndexLike["listSemanticEffectSites"]>;
    args: any[];
    baseValue?: any;
    resultValue?: any;
}

interface ConcreteMethodCandidate {
    method: ArkMethod;
    ownerNames: Set<string>;
}

const concreteMethodCandidatesByNameCache: WeakMap<Scene, Map<string, ConcreteMethodCandidate[]>> = new WeakMap();
const concreteParameterAssignStmtCache: WeakMap<object, ArkAssignStmt[]> = new WeakMap();
const unresolvedVirtualDispatchDiagnosticCache: WeakMap<Scene, WeakMap<object, ReturnType<typeof diagnoseUnresolvedVirtualDispatch>>> = new WeakMap();

function cloneFactAcrossAbilityHandoffBoundary(
    targetNode: PagNode,
    fact: TaintFact,
    currentCtx: number,
    boundary: { preservesFieldPath: boolean },
): TaintFact {
    return new TaintFact(
        targetNode,
        fact.source,
        currentCtx,
        boundary.preservesFieldPath && fact.field ? [...fact.field] : undefined,
    );
}

function buildSyntheticCallSourceNodeIdsByCallSiteAndDst(
    syntheticInvokeEdgeMap: Map<number, SyntheticInvokeEdgeInfo[]>,
): Map<string, number[]> {
    const out = new Map<string, number[]>();
    for (const edges of syntheticInvokeEdgeMap.values()) {
        for (const edge of edges) {
            if (edge.type !== CallEdgeType.CALL) continue;
            const key = syntheticCallArgIndexKey(edge.callSiteId, edge.dstNodeId);
            if (!out.has(key)) out.set(key, []);
            out.get(key)!.push(edge.srcNodeId);
        }
    }
    return out;
}

function syntheticCallArgIndexKey(callSiteId: number, dstNodeId: number): string {
    return `${callSiteId}|${dstNodeId}`;
}

function isOrdinaryFieldCarrierRelayCopy(sourceNode: PagNode, targetNode: PagNode): boolean {
    if (targetNode instanceof PagArrayNode
        || targetNode instanceof PagInstanceFieldNode
        || targetNode instanceof PagStaticFieldNode) {
        return false;
    }
    const sourceValue = sourceNode.getValue?.();
    const targetValue = targetNode.getValue?.();
    if (!(targetValue instanceof Local)) {
        return false;
    }
    const declaringStmt = targetValue.getDeclaringStmt?.();
    if (declaringStmt instanceof ArkAssignStmt && isSameRelaySourceValue(declaringStmt.getRightOp?.(), sourceValue)) {
        return true;
    }
    const relayTargets = collectOrdinaryTaintPreservingDestinationLocals(sourceValue);
    return relayTargets.some(candidate => candidate === targetValue);
}

function isSameRelaySourceValue(a: any, b: any): boolean {
    if (a === b) {
        return true;
    }
    if (a instanceof Local && b instanceof Local) {
        const aStmt = a.getDeclaringStmt?.()?.toString?.() || "";
        const bStmt = b.getDeclaringStmt?.()?.toString?.() || "";
        return (a.getName?.() || "") === (b.getName?.() || "") && aStmt === bStmt;
    }
    if (a instanceof ArkParameterRef && b instanceof ArkParameterRef) {
        return a.getIndex?.() === b.getIndex?.() && String(a) === String(b);
    }
    return false;
}

function containsContainerFieldPath(fieldPath: string[] | undefined): boolean {
    return !!fieldPath?.some(field => fromContainerFieldKey(field) !== null);
}

function formatMemoryUsage(): string {
    const usage = process.memoryUsage();
    const heap = Math.round(usage.heapUsed / 1024 / 1024);
    const rss = Math.round(usage.rss / 1024 / 1024);
    return `heap_mb=${heap} rss_mb=${rss}`;
}

function resolveReturnEdgeContext(
    ctxManager: TaintContextManager,
    currentCtx: number,
    callSiteId: number,
    options?: { allowUnambiguousEmptyContext?: boolean },
): number | undefined {
    const restoredCtx = ctxManager.restoreCallerContextForCallSite(currentCtx, callSiteId);
    if (restoredCtx !== undefined) return restoredCtx;
    if (
        ctxManager.getTopElement(currentCtx) === -1
        && (ctxManager.getK() === 0 || options?.allowUnambiguousEmptyContext)
    ) {
        return currentCtx;
    }
    return undefined;
}

function canResolveEmptyContextReturnExactly(
    ctxManager: TaintContextManager,
    currentCtx: number,
    returnEdges: CallEdgeInfo[],
): boolean {
    if (ctxManager.getTopElement(currentCtx) !== -1) return false;
    if (ctxManager.getK() === 0) return true;
    const callSiteIds = new Set<number>();
    for (const edge of returnEdges) {
        if (edge.type === CallEdgeType.RETURN) {
            callSiteIds.add(edge.callSiteId);
        }
    }
    return callSiteIds.size === 1;
}

export class WorklistSolver {
    private deps: WorklistSolverDeps;

    constructor(deps: WorklistSolverDeps) {
        this.deps = deps;
    }

    public solve(worklist: TaintFact[], visited: Set<string>): void {
        const {
            scene,
            pag,
            tracker,
            ctxManager,
            callEdgeMap,
            receiverFieldBridgeMap,
            captureEdgeMap,
            syntheticInvokeEdgeMap,
            syntheticConstructorStoreMap,
            syntheticStaticInitStoreMap,
            syntheticFieldBridgeMap,
            ensureCaptureEdgesForNode,
            ensureSyntheticInvokeEdgesForNode,
            fieldToVarIndex,
            transferRules,
            apiEffectRuntimeIndex,
            onTransferRuleHit,
            getInitialRuleChainForFact,
            onFactRuleChain,
            profiler,
            traceGraph,
            allowedMethodSignatures,
            moduleRuntime,
            moduleQueries,
            onFactObserved,
            onFactPredecessor,
            onCallEdge,
            onTaintFlow,
            onMethodReached,
            budget,
            log,
            progress,
        } = this.deps;
        const startedAt = Date.now();
        const progressLog = progress || (() => undefined);
        let truncated = false;
        progressLog(`[worklist] precompute start initial=${worklist.length} visited=${visited.size}`);
        const receiverOwnerNameByCallSiteId = new Map<number, string>();
        const registerSyntheticReceiverOwners = (edges: SyntheticInvokeEdgeInfo[] | undefined): void => {
            if (!edges) return;
            for (const edge of edges) {
                if (!edge.receiverOwnerName) continue;
                const existing = receiverOwnerNameByCallSiteId.get(edge.callSiteId);
                if (existing && !ownerNameMatchesAny(edge.receiverOwnerName, new Set([existing]))) continue;
                receiverOwnerNameByCallSiteId.set(edge.callSiteId, edge.receiverOwnerName);
            }
        };
        for (const edges of syntheticInvokeEdgeMap.values()) {
            registerSyntheticReceiverOwners(edges);
        }
        const maybeTruncate = (): boolean => {
            if (truncated) return true;
            if (!budget) return false;
            const elapsedMs = Date.now() - startedAt;
            let reason = "";
            if (budget.maxDequeues && queueHead >= budget.maxDequeues) {
                reason = `maxDequeues:${budget.maxDequeues}`;
            } else if (budget.maxVisited && visited.size >= budget.maxVisited) {
                reason = `maxVisited:${budget.maxVisited}`;
            } else if (budget.maxElapsedMs && elapsedMs >= budget.maxElapsedMs) {
                reason = `maxElapsedMs:${budget.maxElapsedMs}`;
            }
            if (!reason) return false;
            truncated = true;
            const event = {
                reason,
                queueHead,
                queueLength: worklist.length,
                visitedCount: visited.size,
                elapsedMs,
            };
            progressLog(`[WorklistBudget] truncated reason=${reason} head=${queueHead} total=${worklist.length} visited=${visited.size} elapsedMs=${elapsedMs}`);
            budget.onTruncated?.(event);
            return true;
        };
        const measureSection = <T>(section: string, fn: () => T): T =>
            profiler ? profiler.measure(section, fn) : fn();
        const measureLoggedSection = <T>(section: string, fn: () => T): T => {
            const sectionStartedAt = Date.now();
            progressLog(`[worklist] ${section} start`);
            const result = measureSection(section, fn);
            progressLog(`[worklist] ${section} done elapsed_ms=${Date.now() - sectionStartedAt}`);
            return result;
        };
        const transferExecutor = measureSection(
            "precompute_transfer_executor",
            () => new ConfigBasedTransferExecutor(transferRules || [], scene, apiEffectRuntimeIndex),
        );
        progressLog(`[worklist] precompute_transfer_executor done transfer_rules=${(transferRules || []).length}`);
        const unresolvedThisFieldLoadNodeIdsByFieldAndFile = measureLoggedSection("precompute_unresolved_this_field", () => buildUnresolvedThisFieldLoadNodeIdsByFieldAndFile(
            scene,
            pag,
            allowedMethodSignatures
        ));
        const classBySignature = measureLoggedSection("precompute_class_index", () => buildClassSignatureIndex(scene));
        const classRelationCache = new Map<string, boolean>();
        const preciseArrayLoadCache = new Map<string, number[]>();
        const syntheticCallSourceNodeIdsByCallSiteAndDst = measureLoggedSection(
            "precompute_synthetic_call_arg_index",
            () => buildSyntheticCallSourceNodeIdsByCallSiteAndDst(syntheticInvokeEdgeMap),
        );
        const canonicalModuleInvokeSitesByNode = measureLoggedSection(
            "precompute_module_invoke_sites",
            () => collectCanonicalModuleInvokeSitesByNode(
                apiEffectRuntimeIndex,
                pag,
                allowedMethodSignatures,
                classBySignature,
            ),
        );
        const fieldPropagationEngine = new FieldPropagationEngine({
            scene,
            pag,
            tracker,
            classBySignature,
            fieldAccessIndex: FieldAccessIndex.fromFieldToVarIndex(fieldToVarIndex),
            unresolvedThisFieldLoadNodeIdsByFieldAndFile,
            classRelationCache,
            preciseArrayLoadCache,
            ctxManager,
            syntheticCallSourceNodeIdsByCallSiteAndDst,
            syntheticInvokeEdgeMap,
        });
        const ordinarySharedStateIndex = measureLoggedSection("precompute_shared_state_index", () => buildOrdinarySharedStateIndex(scene, pag));
        const objectNodeIdsByClassSignature = measureLoggedSection("precompute_object_node_class_index", () => {
            const out = new Map<string, Set<number>>();
            for (const rawNode of pag.getNodesIter()) {
                const pagNode = rawNode as PagNode;
                const classSig = resolveObjectClassSignatureByNode(pagNode);
                if (!classSig) continue;
                if (!out.has(classSig)) {
                    out.set(classSig, new Set<number>());
                }
                out.get(classSig)!.add(pagNode.getID());
            }
            return out;
        });
        progressLog(`[worklist] precompute done elapsed_ms=${Date.now() - startedAt}`);
        if (unresolvedThisFieldLoadNodeIdsByFieldAndFile.size > 0) {
            let unresolvedLoadCount = 0;
            for (const fileMap of unresolvedThisFieldLoadNodeIdsByFieldAndFile.values()) {
                for (const classMap of fileMap.values()) {
                    for (const ids of classMap.values()) {
                        unresolvedLoadCount += ids.size;
                    }
                }
            }
            log(`[Field-Load] unresolved this-field loads fields=${unresolvedThisFieldLoadNodeIdsByFieldAndFile.size}, loads=${unresolvedLoadCount}`);
        }
        const trackFactRuleChains = !!onFactRuleChain;
        const factRuleChains = trackFactRuleChains ? new Map<string, FactRuleChain>() : undefined;
        const cloneChain = (chain?: FactRuleChain): FactRuleChain => ({
            sourceRuleId: chain?.sourceRuleId,
            transferRuleIds: [...(chain?.transferRuleIds || [])],
        });
        const parseSourceRuleId = (source: string): string | undefined => {
            if (!source.startsWith("source_rule:")) return undefined;
            const rawId = source.slice("source_rule:".length).trim();
            const id = rawId.split("#occ=")[0]?.trim() || "";
            return id.length > 0 ? id : undefined;
        };
        const buildSyntheticEdgeChainOverride = (
            baseChain: FactRuleChain,
            edge: SyntheticInvokeEdgeInfo,
        ): FactRuleChain | undefined => {
            if (edge.originTag !== "execution_handoff") return undefined;
            const suffix = edge.handoffId?.trim() || [
                edge.callSiteId,
                edge.callerSignature || "",
                edge.calleeSignature || "",
                edge.type,
            ].join("|");
            const marker = `ude.handoff.${edge.type === CallEdgeType.CALL ? "call" : "return"}:${suffix}`;
            if (baseChain.transferRuleIds.includes(marker)) return undefined;
            return {
                sourceRuleId: baseChain.sourceRuleId,
                transferRuleIds: [...baseChain.transferRuleIds, marker],
            };
        };
        const initialChainForFact = (fact: TaintFact): FactRuleChain => {
            if (getInitialRuleChainForFact) {
                return cloneChain(getInitialRuleChainForFact(fact));
            }
            return {
                sourceRuleId: parseSourceRuleId(fact.source),
                transferRuleIds: [],
            };
        };
        const mergeRuleChain = (
            baseChain: FactRuleChain,
            override?: EnginePluginRuleChain,
        ): FactRuleChain => ({
            sourceRuleId: override?.sourceRuleId ?? baseChain.sourceRuleId,
            transferRuleIds: [
                ...baseChain.transferRuleIds,
                ...(override?.transferRuleIds || []),
            ],
        });
        const buildFactFromFlowDecl = (
            baseFact: TaintFact,
            decl: FlowDecl | EnqueueFactDecl,
        ): TaintFact | undefined => {
            const targetNode = pag.getNode(decl.nodeId) as PagNode;
            if (!targetNode) return undefined;
            return new TaintFact(
                targetNode,
                decl.source || baseFact.source,
                decl.contextId ?? baseFact.contextID,
                decl.field ? [...decl.field] : (baseFact.field ? [...baseFact.field] : undefined),
            );
        };
        const buildFactFromBridgeDecl = (
            baseFact: TaintFact,
            decl: BridgeDecl,
        ): TaintFact | undefined => {
            const targetObjectNode = pag.getNode(decl.targetObjectNodeId) as PagNode;
            if (!targetObjectNode) return undefined;
            const preserveFieldSuffix = decl.preserveFieldSuffix !== false;
            const targetFieldPath = preserveFieldSuffix && baseFact.field && baseFact.field.length > 1
                ? [decl.targetFieldName, ...baseFact.field.slice(1)]
                : [decl.targetFieldName];
            return new TaintFact(
                targetObjectNode,
                decl.source || baseFact.source,
                decl.contextId ?? baseFact.contextID,
                targetFieldPath,
            );
        };
        const buildFactFromSyntheticEdgeDecl = (
            baseFact: TaintFact,
            decl: SyntheticEdgeDecl,
        ): TaintFact | undefined => {
            const targetNode = pag.getNode(decl.targetNodeId) as PagNode;
            if (!targetNode) return undefined;
            let targetContextId = decl.targetContextId;
            if (targetContextId === undefined) {
                if (decl.edgeType === "call") {
                    targetContextId = ctxManager.createCalleeContext(
                        baseFact.contextID,
                        decl.callSiteId,
                        decl.callerMethodName,
                        decl.calleeMethodName,
                    );
                } else {
                    const restoredCtx = resolveReturnEdgeContext(ctxManager, baseFact.contextID, decl.callSiteId);
                    if (restoredCtx === undefined) {
                        return undefined;
                    }
                    targetContextId = restoredCtx;
                }
            }
            return new TaintFact(
                targetNode,
                decl.source || baseFact.source,
                targetContextId,
                decl.field ? [...decl.field] : (baseFact.field ? [...baseFact.field] : undefined),
            );
        };
        const applyPluginPropagationBatch = (
            batch: PropagationContributionBatch | undefined,
            baseFact: TaintFact,
            baseChain: FactRuleChain,
            tryEnqueueFn: (
                reason: string,
                newFact: TaintFact,
                onAccepted: () => void,
                chainOverride?: FactRuleChain,
                allowUnreachableTarget?: boolean,
            ) => void,
        ): void => {
            if (!batch) return;
            for (const decl of batch.flows) {
                const newFact = buildFactFromFlowDecl(baseFact, decl);
                if (!newFact) continue;
                tryEnqueueFn(
                    decl.reason || "Plugin-Flow",
                    newFact,
                    () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, newFact.source, newFact.field, newFact.taintId);
                        log(`    [Plugin-Flow] Tainted node ${newFact.node.getID()} (ctx=${newFact.contextID})`);
                    },
                    mergeRuleChain(baseChain, decl.chain),
                    decl.allowUnreachableTarget === true,
                );
            }
            for (const decl of batch.bridges) {
                const newFact = buildFactFromBridgeDecl(baseFact, decl);
                if (!newFact) continue;
                tryEnqueueFn(
                    decl.reason || "Plugin-Bridge",
                    newFact,
                    () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, newFact.source, newFact.field, newFact.taintId);
                        log(`    [Plugin-Bridge] Tainted Obj ${newFact.node.getID()}.${newFact.field?.join(".")} (ctx=${newFact.contextID})`);
                    },
                    mergeRuleChain(baseChain, decl.chain),
                    decl.allowUnreachableTarget === true,
                );
            }
            for (const decl of batch.syntheticEdges) {
                const newFact = buildFactFromSyntheticEdgeDecl(baseFact, decl);
                if (!newFact) continue;
                tryEnqueueFn(
                    decl.reason || `Plugin-Synthetic-${decl.edgeType === "call" ? "Call" : "Return"}`,
                    newFact,
                    () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, newFact.source, newFact.field, newFact.taintId);
                        log(`    [Plugin-Synthetic-${decl.edgeType === "call" ? "Call" : "Return"}] Tainted node ${newFact.node.getID()} (ctx=${newFact.contextID})`);
                    },
                    mergeRuleChain(baseChain, decl.chain),
                    decl.allowUnreachableTarget === true,
                );
            }
            for (const decl of batch.facts) {
                const newFact = buildFactFromFlowDecl(baseFact, decl);
                if (!newFact) continue;
                tryEnqueueFn(
                    decl.reason || "Plugin-Fact",
                    newFact,
                    () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, newFact.source, newFact.field, newFact.taintId);
                        log(`    [Plugin-Fact] Tainted node ${newFact.node.getID()} (ctx=${newFact.contextID})`);
                    },
                    mergeRuleChain(baseChain, decl.chain),
                    decl.allowUnreachableTarget === true,
                );
            }
        };
        for (const seedFact of worklist) {
            const chain = initialChainForFact(seedFact);
            if (trackFactRuleChains) {
                factRuleChains!.set(seedFact.taintId, chain);
                onFactRuleChain?.(seedFact.taintId, chain);
            }
            onFactObserved?.(seedFact);
        }
        let queueHead = 0;
        profiler?.onQueueSize(worklist.length - queueHead);
        progressLog(`[worklist] solve loop start total=${worklist.length} visited=${visited.size}`);
        let visitedKeyChars = 0;
        let maxVisitedKeyChars = 0;
        for (const key of visited) {
            visitedKeyChars += key.length;
            if (key.length > maxVisitedKeyChars) maxVisitedKeyChars = key.length;
        }
        const reachedMethodSignatures = new Set<string>();
        const traceWorklist = process.env.ARKTAINT_TRACE_WORKLIST === "1";
        const traceWorklistSections = process.env.ARKTAINT_TRACE_WORKLIST_SECTIONS === "1";
        let lastTraceAt = 0;
        const traceSection = (section: string, fact?: TaintFact): void => {
            if (!traceWorklist) return;
            const now = Date.now();
            if (!traceWorklistSections) {
                if (section !== "dequeue") return;
                if (queueHead % 100 !== 0 && now - lastTraceAt < 5000) return;
            }
            lastTraceAt = now;
            const f = fact;
            const fieldText = f?.field && f.field.length > 0 ? `.${f.field.join(".")}` : "";
            process.stderr.write(
                `[worklist] section=${section} head=${queueHead} total=${worklist.length} visited=${visited.size}`
                + (f ? ` node=${f.node.getID()} ctx=${f.contextID}${fieldText}` : "")
                + "\n",
            );
        };

        while (queueHead < worklist.length) {
            if (maybeTruncate()) {
                break;
            }
            const now = Date.now();
            if (queueHead === 0 || queueHead % 250 === 0 || now - lastTraceAt >= 5000) {
                progressLog(`[worklist] progress head=${queueHead} total=${worklist.length} visited=${visited.size} avg_key_chars=${visited.size > 0 ? Math.round(visitedKeyChars / visited.size) : 0} max_key_chars=${maxVisitedKeyChars} ${formatMemoryUsage()} elapsed_ms=${now - startedAt}`);
                lastTraceAt = now;
            }
            const fact = worklist[queueHead]!;
            worklist[queueHead] = undefined as any;
            queueHead++;
            traceSection("dequeue", fact);
            profiler?.onDequeue(worklist.length - queueHead);
            traceGraph?.recordFact(fact);
            const node = fact.node;
            const currentCtx = fact.contextID;
            const factKey = fact.taintId;
            const currentChain = trackFactRuleChains
                ? (factRuleChains!.get(factKey) || initialChainForFact(fact))
                : initialChainForFact(fact);
            if (trackFactRuleChains) {
                factRuleChains!.set(factKey, currentChain);
                onFactRuleChain?.(factKey, currentChain);
            }
                if (!isNodeAllowedByReachability(node, allowedMethodSignatures)) {
                continue;
            }
            const attemptedEdgesFromCurrentFact = new Set<string>();
            const tryEnqueue = (
                reason: string,
                newFact: TaintFact,
                onAccepted: () => void,
                chainOverride?: FactRuleChain,
                allowUnreachableTarget: boolean = false,
                currentnessCertificates?: CurrentnessCertificate[],
            ): void => {
                if (maybeTruncate()) {
                    traceGraph?.recordPropagationGate(fact, newFact, {
                        reason,
                        status: "blocked",
                        matched: false,
                        blockedReason: "worklist_budget_truncated",
                        evidence: { blockedReason: "worklist_budget_truncated" },
                    });
                    return;
                }
                if (
                    !allowUnreachableTarget
                    && !isNodeAllowedByReachability(newFact.node, allowedMethodSignatures)
                ) {
                    traceGraph?.recordEdge(fact, newFact, {
                        reason,
                        status: "skipped",
                        evidence: { skippedReason: "unreachable_target" },
                    });
                    traceGraph?.recordPropagationGate(fact, newFact, {
                        reason,
                        status: "skipped",
                        matched: false,
                        skippedReason: "unreachable_target",
                        evidence: { skippedReason: "unreachable_target" },
                    });
                    return;
                }
                const currentnessKey = (currentnessCertificates || [])
                    .map(cert => cert.id || "")
                    .sort()
                    .join(",");
                const newFactKey = newFact.taintId;
                const localAttemptKey = `${reason}\u0001${newFactKey}\u0001${currentnessKey}`;
                if (attemptedEdgesFromCurrentFact.has(localAttemptKey)) {
                    traceGraph?.recordPropagationGate(fact, newFact, {
                        reason,
                        status: "skipped",
                        matched: true,
                        skippedReason: "duplicate_attempt_from_current_fact",
                        evidence: { skippedReason: "duplicate_attempt_from_current_fact" },
                    });
                    return;
                }
                attemptedEdgesFromCurrentFact.add(localAttemptKey);
                profiler?.onEnqueueAttempt(reason);
                onFactPredecessor?.({
                    toFactId: newFactKey,
                    fromFactId: factKey,
                    reason,
                    currentnessCertificates,
                    currentnessCertificateIds: currentnessCertificates?.map(cert => cert.id),
                });
                if (visited.has(newFactKey)) {
                    profiler?.onDedupDrop(reason);
                    traceGraph?.recordEdge(fact, newFact, {
                        reason,
                        status: "skipped",
                        evidence: { skippedReason: "visited_dedup" },
                    });
                    traceGraph?.recordPropagationGate(fact, newFact, {
                        reason,
                        status: "skipped",
                        matched: true,
                        skippedReason: "visited_dedup",
                        evidence: { skippedReason: "visited_dedup" },
                    });
                    return;
                }
                visited.add(newFactKey);
                visitedKeyChars += newFactKey.length;
                if (newFactKey.length > maxVisitedKeyChars) maxVisitedKeyChars = newFactKey.length;
                worklist.push(newFact);
                const newChain = cloneChain(chainOverride || currentChain);
                if (trackFactRuleChains) {
                    factRuleChains!.set(newFactKey, newChain);
                    onFactRuleChain?.(newFactKey, newChain);
                }
                onFactObserved?.(newFact);
                profiler?.onEnqueueSuccess(reason, worklist.length - queueHead);
                traceGraph?.recordEdge(fact, newFact, { reason, status: "emitted" });
                traceGraph?.recordPropagationGate(fact, newFact, {
                    reason,
                    status: "emitted",
                    matched: true,
                    emitted: true,
                });
                const taintFlowBatch = onTaintFlow?.({
                    reason,
                    fromFact: fact,
                    toFact: newFact,
                }) || createEmptyPropagationContributionBatch();
                applyPluginPropagationBatch(taintFlowBatch, newFact, newChain, tryEnqueue);
                onAccepted();
            };

            const enqueueFieldEmission = (emission: ReturnType<FieldPropagationEngine["propagate"]>[number]): void => {
                const newFact = emission.fact;
                tryEnqueue(emission.stage, newFact, () => {
                    tracker.markTainted(newFact.node.getID(), newFact.contextID, newFact.source, newFact.field, newFact.taintId);
                    log(emission.message);
                });
            };

                const declaringMethodSignature = resolveDeclaringMethodSignature(node);
            if (declaringMethodSignature && !reachedMethodSignatures.has(declaringMethodSignature)) {
                reachedMethodSignatures.add(declaringMethodSignature);
                const methodReachedBatch = onMethodReached?.({
                    methodSignature: declaringMethodSignature,
                    fact,
                });
                applyPluginPropagationBatch(methodReachedBatch, fact, currentChain, tryEnqueue);
            }

            traceSection("module_fact", fact);
            const moduleEmissions = measureSection("module_fact", () => moduleRuntime.emitForFact({
                scene,
                pag,
                allowedMethodSignatures,
                fieldToVarIndex,
                queries: moduleQueries,
                log,
                fact,
                node,
            } as InternalRawModuleFactEvent));
            for (const emission of moduleEmissions) {
                const newFact = emission.fact;
                tryEnqueue(emission.reason, newFact, () => {
                    tracker.markTainted(newFact.node.getID(), newFact.contextID, newFact.source, newFact.field, newFact.taintId);
                    log(`    [${emission.reason}] Tainted node ${newFact.node.getID()} (ctx=${newFact.contextID})`);
                }, emission.chain, emission.allowUnreachableTarget === true, emission.currentnessCertificates);
            }

            const canonicalModuleInvokeSites = canonicalModuleInvokeSitesByNode.get(node.getID()) || [];
            if (canonicalModuleInvokeSites.length > 0) {
                traceSection("module_invoke", fact);
                const invokedForFact = new Set<string>();
                for (const canonicalOccurrence of canonicalModuleInvokeSites) {
                    const invokeKey = `${canonicalOccurrence.occurrenceId}|${canonicalOccurrence.canonicalApiId}`;
                    if (invokedForFact.has(invokeKey)) continue;
                    invokedForFact.add(invokeKey);
                    const invokeEmissions = measureSection("module_invoke", () => moduleRuntime.emitForInvoke({
                        scene,
                        pag,
                        allowedMethodSignatures,
                        fieldToVarIndex,
                        queries: moduleQueries,
                        log,
                        fact,
                        node,
                        stmt: canonicalOccurrence.stmt,
                        invokeExpr: canonicalOccurrence.invokeExpr,
                        callSignature: canonicalOccurrence.callSignature,
                        methodName: canonicalOccurrence.methodName,
                        declaringClassName: canonicalOccurrence.declaringClassName,
                        canonicalApiId: canonicalOccurrence.canonicalApiId,
                        occurrenceId: canonicalOccurrence.occurrenceId,
                        rawOccurrenceId: canonicalOccurrence.rawOccurrenceId,
                        semanticEffectSites: canonicalOccurrence.semanticEffectSites,
                        args: canonicalOccurrence.args,
                        baseValue: canonicalOccurrence.baseValue,
                        resultValue: canonicalOccurrence.resultValue,
                    } as InternalRawModuleInvokeEvent));
                    for (const emission of invokeEmissions) {
                        const newFact = emission.fact;
                        tryEnqueue(emission.reason, newFact, () => {
                            tracker.markTainted(newFact.node.getID(), newFact.contextID, newFact.source, newFact.field, newFact.taintId);
                            log(`    [${emission.reason}] Tainted node ${newFact.node.getID()} (ctx=${newFact.contextID})`);
                        }, emission.chain, emission.allowUnreachableTarget === true, emission.currentnessCertificates);
                    }
                }
            }

            if (fact.field && fact.field.length > 0) {
                const sourceFieldName = fact.field[0];
                const sourceKey = `${node.getID()}#${sourceFieldName}`;
                const bridgeInfos = syntheticFieldBridgeMap.get(sourceKey) || [];
                for (const bridge of bridgeInfos) {
                    const targetObjectNode = pag.getNode(bridge.targetObjectNodeId) as PagNode;
                    if (!targetObjectNode) continue;
                    const targetFieldPath = bridge.pathMode === "append_source_path"
                        ? [bridge.targetFieldName, ...fact.field]
                        : fact.field.length > 1
                            ? [bridge.targetFieldName, ...fact.field.slice(1)]
                            : [bridge.targetFieldName];
                    const newFact = new TaintFact(
                        targetObjectNode,
                        fact.source,
                        currentCtx,
                        targetFieldPath
                    );
                    tryEnqueue("Synthetic-FieldBridge", newFact, () => {
                        tracker.markTainted(
                            newFact.node.getID(),
                            newFact.contextID,
                            fact.source,
                            newFact.field,
                            newFact.id
                        );
                        log(
                            `    [Synthetic-FieldBridge] Obj ${bridge.sourceObjectNodeId}.${bridge.sourceFieldName} `
                            + `-> Obj ${bridge.targetObjectNodeId}.${targetFieldPath.join(".")} `
                            + `[${bridge.pathMode}] (ctx=${currentCtx})`
                        );
                    });
                }

                const objectLiteralFieldCaptureFacts = collectObjectLiteralFieldCaptureFactsFromObjectField(
                    node.getID(),
                    fact.field,
                    fact.source,
                    currentCtx,
                    pag,
                    classBySignature,
                );
                for (const newFact of objectLiteralFieldCaptureFacts) {
                    tryEnqueue("ObjectLiteral-CaptureField", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                        log(
                            `    [ObjectLiteral-CaptureField] Tainted Obj ${newFact.node.getID()}`
                            + `.${newFact.field?.join(".")} (ctx=${currentCtx})`
                        );
                    });
                }

                const copyLikeResultFacts = collectOrdinaryCopyLikeResultFactsFromTaintedObj(
                    node.getID(),
                    fact.field,
                    fact.source,
                    currentCtx,
                    pag,
                    classBySignature,
                );
                for (const newFact of copyLikeResultFacts) {
                    tryEnqueue("CopyLike-Carrier", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                        log(
                            `    [CopyLike-Carrier] Tainted node ${newFact.node.getID()}`
                            + `${newFact.field?.length ? `.${newFact.field.join(".")}` : ""} from ordinary copy-like carrier`
                            + ` (ctx=${currentCtx})`
                        );
                    });
                }

                const objectFromEntriesFacts = propagateObjectFromEntriesFieldStoresByObj(
                    pag,
                    node.getID(),
                    fact.field,
                    fact.source,
                    currentCtx,
                    classBySignature,
                );
                for (const newFact of objectFromEntriesFacts) {
                    tryEnqueue("Object-FromEntries-Store", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                        log(
                            `    [Object-FromEntries-Store] Tainted Obj ${newFact.node.getID()}`
                            + `.${newFact.field?.join(".")} from Object.fromEntries pair slot (ctx=${currentCtx})`
                        );
                    });
                }

                const queryResultFacts = propagateQueryResultContainerFactsByObj(
                    pag,
                    node.getID(),
                    fact.field,
                    fact.source,
                    currentCtx,
                    classBySignature,
                );
                for (const newFact of queryResultFacts) {
                    tryEnqueue("Query-Result-Container", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                        log(
                            `    [Query-Result-Container] Tainted node ${newFact.node.getID()}`
                            + `${newFact.field?.length ? `.${newFact.field.join(".")}` : ""} from exact query-result field projection`
                            + ` (ctx=${currentCtx})`
                        );
                    });
                }

                const collectionRemainingFieldPath = fact.field.length > 1 ? fact.field.slice(1) : undefined;
                const ordinaryCollectionLoads = collectOrdinaryCollectionLoadEffectsFromTaintedSlot(
                    node.getID(),
                    sourceFieldName,
                    pag,
                    scene,
                    (base, slot, anchorStmt) => isOrdinaryCollectionSlotTaintLiveAtStmt(
                        base,
                        slot,
                        anchorStmt,
                        (value, valueAnchorStmt) => valueCarriesCurrentFactTaint(
                            value,
                            valueAnchorStmt,
                            pag,
                            tracker,
                            fact.source,
                            collectionRemainingFieldPath,
                            classBySignature,
                        ),
                    ),
                );
                for (const targetNodeId of ordinaryCollectionLoads.resultNodeIds) {
                    const targetNode = pag.getNode(targetNodeId) as PagNode;
                    if (!targetNode) continue;
                    const newFact = new TaintFact(
                        targetNode,
                        fact.source,
                        currentCtx,
                        collectionRemainingFieldPath ? [...collectionRemainingFieldPath] : undefined,
                    );
                    tryEnqueue("Collection-Slot-Load", newFact, () => {
                        tracker.markTainted(targetNodeId, currentCtx, fact.source, newFact.field, newFact.taintId);
                        log(`    [Collection-Slot-Load] Tainted node ${targetNodeId} from ordinary collection slot ${sourceFieldName} (ctx=${currentCtx})`);
                    });
                }
                for (const targetNodeId of ordinaryCollectionLoads.callbackParamNodeIds) {
                    const targetNode = pag.getNode(targetNodeId) as PagNode;
                    if (!targetNode) continue;
                    const newFact = new TaintFact(
                        targetNode,
                        fact.source,
                        currentCtx,
                        collectionRemainingFieldPath ? [...collectionRemainingFieldPath] : undefined,
                    );
                    tryEnqueue("Collection-Slot-CB", newFact, () => {
                        tracker.markTainted(targetNodeId, currentCtx, fact.source, newFact.field, newFact.taintId);
                        log(`    [Collection-Slot-CB] Tainted callback param node ${targetNodeId} from ordinary collection slot ${sourceFieldName} (ctx=${currentCtx})`);
                    });
                }
                for (const store of ordinaryCollectionLoads.resultSlotStores) {
                    const targetNode = pag.getNode(store.objId) as PagNode;
                    if (!targetNode) continue;
                    const newFact = new TaintFact(
                        targetNode,
                        fact.source,
                        currentCtx,
                        [toContainerFieldKey(store.slot), ...fact.field.slice(1)],
                    );
                    tryEnqueue("Collection-View-ResultStore", newFact, () => {
                        tracker.markTainted(targetNode.getID(), currentCtx, fact.source, newFact.field, newFact.taintId);
                        log(`    [Collection-View-ResultStore] Tainted Obj ${targetNode.getID()}.${store.slot} from ordinary collection view (ctx=${currentCtx})`);
                    });
                }

                const containerSlot = fromContainerFieldKey(sourceFieldName);
                if (containerSlot && containerSlot.startsWith("arr:")) {
                    const arrayRemainingFieldPath = fact.field.length > 1 ? fact.field.slice(1) : undefined;
                    const ordinaryArrayHigherOrderFromSlot = collectOrdinaryArrayHigherOrderEffectsFromTaintedSlot(
                        node.getID(),
                        containerSlot,
                        pag,
                        scene,
                    );
                    for (const targetNodeId of ordinaryArrayHigherOrderFromSlot.callbackParamNodeIds) {
                        const targetNode = pag.getNode(targetNodeId) as PagNode;
                        if (!targetNode) continue;
                        const newFact = new TaintFact(
                            targetNode,
                            fact.source,
                            currentCtx,
                            arrayRemainingFieldPath ? [...arrayRemainingFieldPath] : undefined,
                        );
                        tryEnqueue("Array-Slot-HOF-CB", newFact, () => {
                            tracker.markTainted(targetNodeId, currentCtx, fact.source, newFact.field, newFact.taintId);
                            log(`    [Array-Slot-HOF-CB] Tainted callback param node ${targetNodeId} from ordinary array slot ${containerSlot} (ctx=${currentCtx})`);
                        });
                    }
                    for (const targetNodeId of ordinaryArrayHigherOrderFromSlot.resultNodeIds) {
                        const targetNode = pag.getNode(targetNodeId) as PagNode;
                        if (!targetNode) continue;
                        const newFact = new TaintFact(
                            targetNode,
                            fact.source,
                            currentCtx,
                            arrayRemainingFieldPath ? [...arrayRemainingFieldPath] : undefined,
                        );
                        tryEnqueue("Array-Slot-HOF-Result", newFact, () => {
                            tracker.markTainted(targetNodeId, currentCtx, fact.source, newFact.field, newFact.taintId);
                            log(`    [Array-Slot-HOF-Result] Tainted result node ${targetNodeId} from ordinary array slot ${containerSlot} (ctx=${currentCtx})`);
                        });
                    }
                    for (const store of ordinaryArrayHigherOrderFromSlot.resultSlotStores) {
                        const targetNode = pag.getNode(store.objId) as PagNode;
                        if (!targetNode) continue;
                        const newFact = new TaintFact(
                            targetNode,
                            fact.source,
                            currentCtx,
                            [toContainerFieldKey(store.slot), ...fact.field.slice(1)],
                        );
                        tryEnqueue("Array-Slot-HOF-ResultStore", newFact, () => {
                            tracker.markTainted(targetNode.getID(), currentCtx, fact.source, newFact.field, newFact.taintId);
                            log(`    [Array-Slot-HOF-ResultStore] Tainted Obj ${targetNode.getID()}.${store.slot} from ordinary array higher-order slot flow (ctx=${currentCtx})`);
                        });
                    }

                    const promiseAggregateEffects = collectOrdinaryPromiseAggregateEffectsFromArraySlot(
                        node.getID(),
                        containerSlot,
                        pag,
                        scene,
                    );
                    for (const store of promiseAggregateEffects.resultSlotStores) {
                        const targetNode = pag.getNode(store.objId) as PagNode;
                        if (!targetNode) continue;
                        const newFact = new TaintFact(
                            targetNode,
                            fact.source,
                            currentCtx,
                            [toContainerFieldKey(store.slot), ...fact.field.slice(1)],
                        );
                        tryEnqueue("Promise-Aggregate-ResultStore", newFact, () => {
                            tracker.markTainted(targetNode.getID(), currentCtx, fact.source, newFact.field, newFact.taintId);
                            log(`    [Promise-Aggregate-ResultStore] Tainted Obj ${targetNode.getID()}.${store.slot} from Promise aggregate result (ctx=${currentCtx})`);
                        });
                    }
                }

                if (!containsContainerFieldPath(fact.field)) {
                    const carrierAliasLocals = collectAliasLocalsForCarrier(pag, node.getID(), classBySignature);
                    const carrierFieldStoreSeen = new Set<string>();
                    for (const aliasLocal of carrierAliasLocals) {
                        const ordinaryArrayMutation = collectOrdinaryArrayMutationEffectsFromTaintedLocal(aliasLocal, pag);
                        for (const store of ordinaryArrayMutation.slotStores) {
                            const targetCarrierId = store.carrierNodeId ?? store.objId;
                            const key = `array|${targetCarrierId}|${store.slot}|${fact.field.join(".")}`;
                            if (carrierFieldStoreSeen.has(key)) continue;
                            carrierFieldStoreSeen.add(key);
                            const targetNode = pag.getNode(targetCarrierId) as PagNode;
                            if (!targetNode) continue;
                            const newFact = new TaintFact(
                                targetNode,
                                fact.source,
                                currentCtx,
                                [toContainerFieldKey(store.slot), ...fact.field],
                            );
                            tryEnqueue("Array-Mutation-CarrierField", newFact, () => {
                                tracker.markTainted(targetNode.getID(), currentCtx, fact.source, newFact.field, newFact.taintId);
                                log(
                                    `    [Array-Mutation-CarrierField] Tainted carrier ${targetNode.getID()}.${store.slot} `
                                    + `from object carrier field ${fact.field?.join(".")} (obj=${store.objId}, ctx=${currentCtx})`
                                );
                            });
                        }

                        const ordinaryCollectionMutation = collectOrdinaryCollectionMutationEffectsFromTaintedLocal(aliasLocal, pag);
                        for (const store of ordinaryCollectionMutation.slotStores) {
                            const targetCarrierId = store.carrierNodeId ?? store.objId;
                            const key = `collection|${targetCarrierId}|${store.slot}|${fact.field.join(".")}`;
                            if (carrierFieldStoreSeen.has(key)) continue;
                            carrierFieldStoreSeen.add(key);
                            const targetNode = pag.getNode(targetCarrierId) as PagNode;
                            if (!targetNode) continue;
                            const newFact = new TaintFact(
                                targetNode,
                                fact.source,
                                currentCtx,
                                [toContainerFieldKey(store.slot), ...fact.field],
                            );
                            tryEnqueue("Collection-Mutation-CarrierField", newFact, () => {
                                tracker.markTainted(targetNode.getID(), currentCtx, fact.source, newFact.field, newFact.taintId);
                                log(
                                    `    [Collection-Mutation-CarrierField] Tainted carrier ${targetNode.getID()}.${store.slot} `
                                    + `from object carrier field ${fact.field?.join(".")} (obj=${store.objId}, ctx=${currentCtx})`
                                );
                            });
                        }
                    }
                }
            }

            traceSection("expr", fact);
            const exprTargetNodes = measureSection("expr", () => propagateExpressionTaint(
                node.getID(),
                node.getValue(),
                currentCtx,
                tracker,
                pag,
                fact.field,
                fact.source,
            ));
            for (const targetNodeId of exprTargetNodes) {
                const targetNode = pag.getNode(targetNodeId) as PagNode;
                const newFact = new TaintFact(targetNode, fact.source, currentCtx, fact.field);
                tryEnqueue("Expr", newFact, () => {
                    tracker.markTainted(targetNodeId, currentCtx, fact.source, newFact.field, newFact.taintId);
                    log(`    [Expr] Tainted node ${targetNodeId} (ctx=${currentCtx})`);
                });
            }

            traceSection("copylike_stringify", fact);
            const serializedStringFacts = measureSection("copylike_stringify", () => collectOrdinarySerializedStringResultFactsFromTaintedLocal(
                node,
                fact.source,
                currentCtx,
                pag,
            ));
            for (const newFact of serializedStringFacts) {
                tryEnqueue("CopyLike-Stringify", newFact, () => {
                    tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                    log(`    [CopyLike-Stringify] Tainted serialized result node ${newFact.node.getID()} (ctx=${currentCtx})`);
                });
            }

            traceSection("copylike_scalar_result", fact);
            const copyLikeScalarResultFacts = measureSection("copylike_scalar_result", () => collectOrdinaryCopyLikeScalarResultFactsFromTaintedLocal(
                node,
                fact.source,
                currentCtx,
                pag,
                fact.field,
            ));
            for (const newFact of copyLikeScalarResultFacts) {
                tryEnqueue("CopyLike-ScalarResult", newFact, () => {
                    tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                    log(`    [CopyLike-ScalarResult] Tainted copy-like result node ${newFact.node.getID()} (ctx=${currentCtx})`);
                });
            }

            traceSection("await_result", fact);
            const awaitResultFacts = measureSection("await_result", () => collectOrdinaryAwaitResultFactsFromTaintedLocal(
                node,
                fact.source,
                currentCtx,
                pag,
                fact.field,
            ));
            for (const newFact of awaitResultFacts) {
                tryEnqueue("Await-Result", newFact, () => {
                    tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                    log(`    [Await-Result] Tainted awaited result node ${newFact.node.getID()} (ctx=${currentCtx})`);
                });
            }

            traceSection("promise_then_callback", fact);
            const promiseThenCallbackParamNodeIds = measureSection(
                "promise_then_callback",
                () => collectOrdinaryPromiseThenCallbackParamNodeIdsFromTaintedLocal(
                    node,
                    pag,
                    scene,
                ),
            );
            for (const targetNodeId of promiseThenCallbackParamNodeIds) {
                const targetNode = pag.getNode(targetNodeId) as PagNode;
                if (!targetNode) continue;
                const newFact = new TaintFact(
                    targetNode,
                    fact.source,
                    currentCtx,
                    fact.field ? [...fact.field] : undefined,
                );
                tryEnqueue("Promise-Then-CB", newFact, () => {
                    tracker.markTainted(targetNodeId, currentCtx, fact.source, newFact.field, newFact.taintId);
                    log(`    [Promise-Then-CB] Tainted callback param node ${targetNodeId} from promise result (ctx=${currentCtx})`);
                });
            }

            traceSection("rule_transfer", fact);
            const transferExec = measureSection("rule_transfer", () => transferExecutor.executeFromTaintedFactWithStats(
                fact,
                pag,
                tracker
            ));
            profiler?.onTransferStats(transferExec.stats);
            const transferResults = transferExec.results;
            for (const transferResult of transferResults) {
                const newFact = transferResult.fact;
                const chainWithTransfer: FactRuleChain = {
                    sourceRuleId: currentChain.sourceRuleId,
                    transferRuleIds: [...currentChain.transferRuleIds, transferResult.ruleId],
                };
                tryEnqueue("Rule-Transfer", newFact, () => {
                    tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                    onTransferRuleHit?.(transferResult);
                    const fieldSuffix = newFact.field && newFact.field.length > 0
                        ? `.${newFact.field.join(".")}`
                        : "";
                    log(`    [Rule-Transfer] ${transferResult.ruleId}: ${transferResult.callSignature} -> node ${newFact.node.getID()}${fieldSuffix} (ctx=${newFact.contextID})`);
                }, chainWithTransfer);
            }

            if (!fact.field || fact.field.length === 0) {
                const capturedFieldFacts = propagateCapturedFieldWrites(pag, node, fact.source, currentCtx, classBySignature);
                for (const newFact of capturedFieldFacts) {
                    tryEnqueue("Capture-Store", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                        log(`    [Capture-Store] Tainted field '${newFact.field?.[0]}' of Obj ${newFact.node.getID()} (ctx=${currentCtx})`);
                    });
                }

                const objectLiteralCaptureFacts = collectObjectLiteralFieldCaptureFactsFromValue(
                    node,
                    fact.source,
                    currentCtx,
                    pag,
                    classBySignature,
                );
                for (const newFact of objectLiteralCaptureFacts) {
                    tryEnqueue("ObjectLiteral-CaptureValue", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                        log(
                            `    [ObjectLiteral-CaptureValue] Tainted Obj ${newFact.node.getID()}`
                            + `.${newFact.field?.join(".")} (ctx=${currentCtx})`
                        );
                    });
                }

            }

            const closureWritebackFacts = collectOrdinaryClosureLocalWritebackFactsFromTaintedLocal(
                node,
                fact.source,
                currentCtx,
                pag,
                scene,
                fact.field,
            );
            for (const newFact of closureWritebackFacts) {
                tryEnqueue("Closure-Local-Writeback", newFact, () => {
                    tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                    const fieldSuffix = newFact.field && newFact.field.length > 0 ? `.${newFact.field.join(".")}` : "";
                    log(`    [Closure-Local-Writeback] Tainted captured local node ${newFact.node.getID()}${fieldSuffix} (ctx=${newFact.contextID})`);
                });
            }

            const closureReadbackFacts = collectOrdinaryClosureLocalReadbackFactsFromParentLocal(
                node,
                fact.source,
                currentCtx,
                pag,
                scene,
                fact.field,
            );
            for (const newFact of closureReadbackFacts) {
                tryEnqueue("Closure-Local-Readback", newFact, () => {
                    tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                    const fieldSuffix = newFact.field && newFact.field.length > 0 ? `.${newFact.field.join(".")}` : "";
                    log(`    [Closure-Local-Readback] Tainted captured read local node ${newFact.node.getID()}${fieldSuffix} (ctx=${newFact.contextID})`);
                });
            }

            if (!fact.field || fact.field.length === 0) {
                const reflectSetFacts = propagateReflectSetFieldStores(pag, node, fact.source, currentCtx);
                for (const newFact of reflectSetFacts) {
                    tryEnqueue("Reflect-Store", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                        log(`    [Reflect-Store] Tainted field '${newFact.field?.[0]}' of Obj ${newFact.node.getID()} (ctx=${currentCtx})`);
                    });
                }
            }

            const captureEdges = ensureCaptureEdgesForNode
                ? (ensureCaptureEdgesForNode(node.getID()) || captureEdgeMap.get(node.getID()))
                : captureEdgeMap.get(node.getID());
            if (captureEdges) {
                for (const captureEdge of captureEdges) {
                    if (captureEdge.direction === "backward" && fact.field && fact.field.length > 0) {
                        continue;
                    }
                    const targetNode = pag.getNode(captureEdge.dstNodeId) as PagNode;
                    let newCtx = currentCtx;
                    if (captureEdge.direction === "backward") {
                        const restoredCtx = ctxManager.restoreCallerContextForCallSite(currentCtx, captureEdge.callSiteId);
                        if (restoredCtx === undefined) {
                            continue;
                        }
                        newCtx = restoredCtx;
                    } else {
                        newCtx = ctxManager.createCalleeContext(
                            currentCtx,
                            captureEdge.callSiteId,
                            captureEdge.callerMethodName,
                            captureEdge.calleeMethodName
                        );
                    }
                    const propagatedFieldPath = captureEdge.direction === "forward" && fact.field && fact.field.length > 0
                        ? [...fact.field]
                        : undefined;
                    const newFact = new TaintFact(targetNode, fact.source, newCtx, propagatedFieldPath);
                    tryEnqueue(captureEdge.direction === "backward" ? "Capture-Backward" : "Capture", newFact, () => {
                        tracker.markTainted(captureEdge.dstNodeId, newCtx, fact.source, propagatedFieldPath, newFact.taintId);
                        log(
                            `    [Capture-${captureEdge.direction === "backward" ? "Bwd" : "Fwd"}] `
                            + `${captureEdge.callerMethodName} -> ${captureEdge.calleeMethodName}, `
                            + `node ${node.getID()} -> ${captureEdge.dstNodeId}, ctx: ${currentCtx} -> ${newCtx}`
                            + (propagatedFieldPath && propagatedFieldPath.length > 0
                                ? `, field=${propagatedFieldPath.join(".")}`
                                : "")
                        );
                    });
                }
            }

            const syntheticEdges = ensureSyntheticInvokeEdgesForNode
                ? (ensureSyntheticInvokeEdgesForNode(node.getID()) || syntheticInvokeEdgeMap.get(node.getID()))
                : syntheticInvokeEdgeMap.get(node.getID());
            if (syntheticEdges) {
                registerSyntheticReceiverOwners(syntheticEdges);
                for (const edge of syntheticEdges) {
                    if (!isSyntheticReceiverOwnerContextAllowed(
                        edge,
                        currentCtx,
                        ctxManager,
                        receiverOwnerNameByCallSiteId,
                    )) {
                        continue;
                    }
                    if (fact.field && fact.field.length > 0 && !edge.preserveFieldPath) {
                        continue;
                    }
                    let newCtx = currentCtx;
                    if (edge.type === CallEdgeType.CALL) {
                        newCtx = ctxManager.createCalleeContext(
                            currentCtx,
                            edge.callSiteId,
                            edge.callerMethodName,
                            edge.calleeMethodName
                        );
                    } else if (edge.type === CallEdgeType.RETURN) {
                        const restoredCtx = resolveReturnEdgeContext(ctxManager, currentCtx, edge.callSiteId);
                        if (restoredCtx === undefined) {
                            continue;
                        }
                        newCtx = restoredCtx;
                    }

                    const targetNode = pag.getNode(edge.dstNodeId) as PagNode;
                    const newFact = new TaintFact(
                        targetNode,
                        fact.source,
                        newCtx,
                        edge.preserveFieldPath && fact.field ? [...fact.field] : undefined,
                    );
                    const reason = edge.type === CallEdgeType.CALL ? "Synthetic-Call" : "Synthetic-Return";
                    const pluginCallEdgeBatch = onCallEdge?.({
                        reason,
                        edgeType: edge.type === CallEdgeType.CALL ? "call" : "return",
                        callSiteId: edge.callSiteId,
                        callerMethodName: edge.callerMethodName,
                        calleeMethodName: edge.calleeMethodName,
                        sourceNodeId: edge.srcNodeId,
                        targetNodeId: edge.dstNodeId,
                        fromContextId: currentCtx,
                        toContextId: newCtx,
                        fact,
                    });
                    applyPluginPropagationBatch(pluginCallEdgeBatch, fact, currentChain, tryEnqueue);
                    const syntheticEdgeChain = buildSyntheticEdgeChainOverride(currentChain, edge);
                    tryEnqueue(reason, newFact, () => {
                        tracker.markTainted(edge.dstNodeId, newCtx, fact.source, newFact.field, newFact.taintId);
                        log(`    [Synthetic-${edge.type === CallEdgeType.CALL ? "Call" : "Return"}] ${edge.callerMethodName} -> ${edge.calleeMethodName}, ${edge.srcNodeId} -> ${edge.dstNodeId}, ctx: ${currentCtx} -> ${newCtx}`);
                    }, syntheticEdgeChain);
                }
            }

            const ctorStores = [
                ...(syntheticConstructorStoreMap.get(node.getID()) || []),
                ...collectDynamicSyntheticConstructorStores(scene, pag, node.getValue?.(), node.getID()),
            ];
            if (ctorStores.length > 0) {
                const seenCtorStores = new Set<string>();
                for (const info of ctorStores) {
                    const ctorStoreKey = `${info.srcNodeId}|${info.objId}|${info.fieldName}|${info.sourceFieldPath?.join(".") || ""}`;
                    if (seenCtorStores.has(ctorStoreKey)) continue;
                    seenCtorStores.add(ctorStoreKey);
                    const objNode = pag.getNode(info.objId) as PagNode;
                    const sourceFieldPath = info.sourceFieldPath || [];
                    let targetFieldPath: string[] | undefined;
                    if (sourceFieldPath.length > 0) {
                        if (fact.field && fact.field.length > 0) {
                            let matchesSourcePath = fact.field.length >= sourceFieldPath.length;
                            for (let i = 0; i < sourceFieldPath.length && matchesSourcePath; i++) {
                                matchesSourcePath = fact.field[i] === sourceFieldPath[i];
                            }
                            if (!matchesSourcePath) continue;
                            targetFieldPath = [info.fieldName, ...fact.field.slice(sourceFieldPath.length)];
                        } else {
                            targetFieldPath = [info.fieldName];
                        }
                    } else {
                        if (fact.field && fact.field.length > 0 && !canConstructorStoreSourceCarryNestedFieldPath(pag.getNode(info.srcNodeId) as PagNode | undefined)) {
                            continue;
                        }
                        targetFieldPath = fact.field && fact.field.length > 0
                            ? [info.fieldName, ...fact.field]
                            : [info.fieldName];
                    }
                    const newFact = new TaintFact(objNode, fact.source, currentCtx, targetFieldPath);
                    tryEnqueue("Synthetic-CtorStore", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                        log(`    [Synthetic-CtorStore] arg ${info.srcNodeId} -> Obj ${info.objId}.${newFact.field?.join(".")} (ctx=${currentCtx})`);
                    });
                }
            }

            if (!fact.field || fact.field.length === 0) {
                const errorMessageFacts = collectOrdinaryErrorMessageFactsFromTaintedLocal(
                    node,
                    fact.source,
                    currentCtx,
                    pag,
                );
                for (const newFact of errorMessageFacts) {
                    tryEnqueue("Error-Message-Store", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                        log(`    [Error-Message-Store] Tainted Error.message on node ${newFact.node.getID()} (ctx=${currentCtx})`);
                    });
                }
            }

            if (!fact.field || fact.field.length === 0) {
                const regexArrayFacts = collectOrdinaryRegexArrayResultFactsFromTaintedLocal(
                    node,
                    fact.source,
                    currentCtx,
                    pag,
                );
                for (const newFact of regexArrayFacts) {
                    tryEnqueue("Regex-MatchArray", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                        log(`    [Regex-MatchArray] Tainted regex result node ${newFact.node.getID()}.${newFact.field?.join(".")} (ctx=${newFact.contextID})`);
                    });
                }
            }

            const staticInitStores = syntheticStaticInitStoreMap.get(node.getID());
            if (staticInitStores && (!fact.field || fact.field.length === 0)) {
                const sharedStateCtx = normalizeSharedStateContext(ctxManager, currentCtx);
                for (const info of staticInitStores) {
                    const staticFieldNode = pag.getNode(info.staticFieldNodeId) as PagNode;
                    if (!staticFieldNode) continue;
                    const newFact = new TaintFact(staticFieldNode, fact.source, sharedStateCtx);
                    tryEnqueue("Synthetic-StaticInitStore", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                        log(`    [Synthetic-StaticInitStore] local ${info.srcNodeId} -> static field ${info.staticFieldNodeId} (ctx=${sharedStateCtx})`);
                    });
                }
            }

            if (!fact.field || fact.field.length === 0) {
            const restArgFacts = propagateRestArrayParam(scene, pag, ctxManager, node, fact.source, currentCtx);
                for (const newFact of restArgFacts) {
                    tryEnqueue("Rest-Arg", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                        log(`    [Rest-Arg] Tainted rest param node ${newFact.node.getID()} (ctx=${newFact.contextID})`);
                    });
                }
            }

            const exactVirtualDispatchFacts = collectExactOrdinaryVirtualDispatchParamFacts(
                scene,
                pag,
                node,
                fact.source,
                currentCtx,
                fact.field,
            );
            for (const newFact of exactVirtualDispatchFacts) {
                tryEnqueue("Ordinary-VirtualDispatch-Arg", newFact, () => {
                    tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                    log(
                        `    [Ordinary-VirtualDispatch-Arg] Tainted concrete callee parameter node ${newFact.node.getID()} `
                        + `(ctx=${newFact.contextID})`
                    );
                }, undefined, true);
            }

            if (!fact.field || fact.field.length === 0) {
            const arrayLoadFacts = propagateArrayElementLoads(pag, node, fact.source, currentCtx);
                for (const newFact of arrayLoadFacts) {
                    tryEnqueue("Array-Load", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                        log(`    [Array-Load] Tainted array read node ${newFact.node.getID()} (ctx=${newFact.contextID})`);
                    });
                }
            }

            if (!fact.field || fact.field.length === 0) {
                const value = node.getValue?.();
                if (value instanceof Local) {
                    const preciseArrayLoadNodeIds = collectPreciseArrayLoadNodeIdsFromTaintedLocal(value, pag);
                    for (const targetNodeId of preciseArrayLoadNodeIds) {
                        const targetNode = pag.getNode(targetNodeId) as PagNode;
                        if (!targetNode) continue;
                        const newFact = new TaintFact(targetNode, fact.source, currentCtx);
                        tryEnqueue("Array-Precise", newFact, () => {
                            tracker.markTainted(targetNodeId, currentCtx, fact.source, newFact.field, newFact.taintId);
                            log(`    [Array-Precise] Tainted node ${targetNodeId} from ordinary array slot load (ctx=${currentCtx})`);
                        });
                    }

                    const ordinaryArrayMutation = collectOrdinaryArrayMutationEffectsFromTaintedLocal(value, pag);
                    for (const targetNodeId of ordinaryArrayMutation.baseNodeIds) {
                        const targetNode = pag.getNode(targetNodeId) as PagNode;
                        if (!targetNode) continue;
                        const newFact = new TaintFact(targetNode, fact.source, currentCtx);
                        tryEnqueue("Array-Mutation-Base", newFact, () => {
                            tracker.markTainted(targetNodeId, currentCtx, fact.source, newFact.field, newFact.taintId);
                            log(`    [Array-Mutation-Base] Tainted node ${targetNodeId} via ordinary array mutation (ctx=${currentCtx})`);
                        });
                    }
                    for (const store of ordinaryArrayMutation.slotStores) {
                        const targetCarrierId = store.carrierNodeId ?? store.objId;
                        const targetNode = pag.getNode(targetCarrierId) as PagNode;
                        if (!targetNode) continue;
                        const newFact = new TaintFact(
                            targetNode,
                            fact.source,
                            currentCtx,
                            [toContainerFieldKey(store.slot)],
                        );
                        tryEnqueue("Array-Mutation-Slot", newFact, () => {
                            tracker.markTainted(targetNode.getID(), currentCtx, fact.source, newFact.field, newFact.taintId);
                            log(
                                `    [Array-Mutation-Slot] Tainted carrier ${targetNode.getID()}.${store.slot} `
                                + `via ordinary array mutation (obj=${store.objId}, ctx=${currentCtx})`
                            );
                        });
                    }

                    const ordinaryCollectionMutation = collectOrdinaryCollectionMutationEffectsFromTaintedLocal(value, pag);
                    for (const targetNodeId of ordinaryCollectionMutation.baseNodeIds) {
                        const targetNode = pag.getNode(targetNodeId) as PagNode;
                        if (!targetNode) continue;
                        const newFact = new TaintFact(targetNode, fact.source, currentCtx);
                        tryEnqueue("Collection-Mutation-Base", newFact, () => {
                            tracker.markTainted(targetNodeId, currentCtx, fact.source, newFact.field, newFact.taintId);
                            log(`    [Collection-Mutation-Base] Tainted node ${targetNodeId} via ordinary collection mutation (ctx=${currentCtx})`);
                        });
                    }
                    for (const store of ordinaryCollectionMutation.slotStores) {
                        const targetCarrierId = store.carrierNodeId ?? store.objId;
                        const targetNode = pag.getNode(targetCarrierId) as PagNode;
                        if (!targetNode) continue;
                        const newFact = new TaintFact(
                            targetNode,
                            fact.source,
                            currentCtx,
                            [toContainerFieldKey(store.slot)],
                        );
                        tryEnqueue("Collection-Mutation-Slot", newFact, () => {
                            tracker.markTainted(targetNode.getID(), currentCtx, fact.source, newFact.field, newFact.taintId);
                            log(
                                `    [Collection-Mutation-Slot] Tainted carrier ${targetNode.getID()}.${store.slot} `
                                + `via ordinary collection mutation (obj=${store.objId}, ctx=${currentCtx})`
                            );
                        });
                    }

                    const ordinaryArrayHigherOrder = collectOrdinaryArrayHigherOrderEffectsFromTaintedLocal(value, pag, scene);
                    for (const targetNodeId of ordinaryArrayHigherOrder.callbackParamNodeIds) {
                        const targetNode = pag.getNode(targetNodeId) as PagNode;
                        if (!targetNode) continue;
                        const newFact = new TaintFact(targetNode, fact.source, currentCtx);
                        tryEnqueue("Array-HOF-CB", newFact, () => {
                            tracker.markTainted(targetNodeId, currentCtx, fact.source, newFact.field, newFact.taintId);
                            log(`    [Array-HOF-CB] Tainted callback param node ${targetNodeId} from ordinary array higher-order flow (ctx=${currentCtx})`);
                        });
                    }
                    for (const targetNodeId of ordinaryArrayHigherOrder.resultNodeIds) {
                        const targetNode = pag.getNode(targetNodeId) as PagNode;
                        if (!targetNode) continue;
                        const newFact = new TaintFact(targetNode, fact.source, currentCtx);
                        tryEnqueue("Array-HOF-Result", newFact, () => {
                            tracker.markTainted(targetNodeId, currentCtx, fact.source, newFact.field, newFact.taintId);
                            log(`    [Array-HOF-Result] Tainted result node ${targetNodeId} from ordinary array higher-order flow (ctx=${currentCtx})`);
                        });
                    }
                    for (const store of ordinaryArrayHigherOrder.resultSlotStores) {
                        const targetNode = pag.getNode(store.objId) as PagNode;
                        if (!targetNode) continue;
                        const newFact = new TaintFact(
                            targetNode,
                            fact.source,
                            currentCtx,
                            [toContainerFieldKey(store.slot)],
                        );
                        tryEnqueue("Array-HOF-ResultStore", newFact, () => {
                            tracker.markTainted(targetNode.getID(), currentCtx, fact.source, newFact.field, newFact.taintId);
                            log(`    [Array-HOF-ResultStore] Tainted Obj ${targetNode.getID()}.${store.slot} from ordinary array higher-order flow (ctx=${currentCtx})`);
                        });
                    }

                    const ordinaryArrayCtor = collectOrdinaryArrayConstructorEffectsFromTaintedLocal(value, pag);
                    for (const targetNodeId of ordinaryArrayCtor.resultNodeIds) {
                        const targetNode = pag.getNode(targetNodeId) as PagNode;
                        if (!targetNode) continue;
                        const newFact = new TaintFact(targetNode, fact.source, currentCtx);
                        tryEnqueue("Array-Constructor", newFact, () => {
                            tracker.markTainted(targetNodeId, currentCtx, fact.source, newFact.field, newFact.taintId);
                            log(`    [Array-Constructor] Tainted result node ${targetNodeId} from ordinary array constructor/view flow (ctx=${currentCtx})`);
                        });
                    }
                    for (const store of ordinaryArrayCtor.resultSlotStores) {
                        const targetNode = pag.getNode(store.objId) as PagNode;
                        if (!targetNode) continue;
                        const newFact = new TaintFact(
                            targetNode,
                            fact.source,
                            currentCtx,
                            [toContainerFieldKey(store.slot)],
                        );
                        tryEnqueue("Array-Constructor-Store", newFact, () => {
                            tracker.markTainted(targetNode.getID(), currentCtx, fact.source, newFact.field, newFact.taintId);
                            log(`    [Array-Constructor-Store] Tainted Obj ${targetNode.getID()}.${store.slot} from ordinary array constructor/view flow (ctx=${currentCtx})`);
                        });
                    }

                    const ordinaryStringSplit = collectOrdinaryStringSplitEffectsFromTaintedLocal(value, pag);
                    for (const targetNodeId of ordinaryStringSplit.resultNodeIds) {
                        const targetNode = pag.getNode(targetNodeId) as PagNode;
                        if (!targetNode) continue;
                        const newFact = new TaintFact(targetNode, fact.source, currentCtx);
                        tryEnqueue("String-Split", newFact, () => {
                            tracker.markTainted(targetNodeId, currentCtx, fact.source, newFact.field, newFact.taintId);
                            log(`    [String-Split] Tainted result node ${targetNodeId} from ordinary string split (ctx=${currentCtx})`);
                        });
                    }
                    for (const store of ordinaryStringSplit.resultSlotStores) {
                        const targetNode = pag.getNode(store.objId) as PagNode;
                        if (!targetNode) continue;
                        const newFact = new TaintFact(
                            targetNode,
                            fact.source,
                            currentCtx,
                            [toContainerFieldKey(store.slot)],
                        );
                        tryEnqueue("String-Split-Store", newFact, () => {
                            tracker.markTainted(targetNode.getID(), currentCtx, fact.source, newFact.field, newFact.taintId);
                            log(`    [String-Split-Store] Tainted Obj ${targetNode.getID()}.${store.slot} from ordinary string split (ctx=${currentCtx})`);
                        });
                    }

                    const arrayFromMapperCallbackParamNodeIds = collectOrdinaryArrayFromMapperCallbackParamNodeIdsFromTaintedLocal(
                        value,
                        pag,
                        scene,
                    );
                    for (const targetNodeId of arrayFromMapperCallbackParamNodeIds) {
                        const targetNode = pag.getNode(targetNodeId) as PagNode;
                        if (!targetNode) continue;
                        const newFact = new TaintFact(targetNode, fact.source, currentCtx);
                        tryEnqueue("Array-From-Mapper-CB", newFact, () => {
                            tracker.markTainted(targetNodeId, currentCtx, fact.source, newFact.field, newFact.taintId);
                            log(`    [Array-From-Mapper-CB] Tainted callback param node ${targetNodeId} from ordinary Array.from mapper (ctx=${currentCtx})`);
                        });
                    }
                }
            }

            const copyEdges = node.getOutgoingCopyEdges();
            if (copyEdges) {
                const copyEdgeList = Array.from(copyEdges.values ? copyEdges.values() : copyEdges);
                const returnEdgesForCurrentNode: CallEdgeInfo[] = [];
                for (const edge of copyEdgeList) {
                    const edgeInfo = callEdgeMap.get(`${node.getID()}->${edge.getDstID()}`);
                    if (edgeInfo?.type === CallEdgeType.RETURN) {
                        returnEdgesForCurrentNode.push(edgeInfo);
                    }
                }
                const allowUnambiguousEmptyReturn = canResolveEmptyContextReturnExactly(
                    ctxManager,
                    currentCtx,
                    returnEdgesForCurrentNode,
                );
                for (const edge of copyEdgeList) {
                    if (moduleRuntime.shouldSkipCopyEdge({
                        scene,
                        pag,
                        node,
                        contextId: currentCtx,
                    })) {
                        continue;
                    }

                    const targetNodeId = edge.getDstID();
                    const targetNode = pag.getNode(targetNodeId) as PagNode;
                    const edgeKey = `${node.getID()}->${targetNodeId}`;

                    if (
                        (!fact.field || fact.field.length === 0)
                        && !callEdgeMap.get(edgeKey)
                        && (
                            targetNode instanceof PagArrayNode
                            || targetNode instanceof PagInstanceFieldNode
                        )
                    ) {
                        continue;
                    }

                    const callEdgeInfo = callEdgeMap.get(edgeKey);
                    const ordinaryVirtualDispatch = !callEdgeInfo
                        ? resolveExactOrdinaryVirtualDispatchCopy(scene, node, targetNode)
                        : undefined;
                    if (ordinaryVirtualDispatch) {
                        log(
                            `    [Ordinary-VirtualDispatch] ${ordinaryVirtualDispatch.ownerName}.${ordinaryVirtualDispatch.methodName} `
                            + `accepted copy ${node.getID()} -> ${targetNodeId} from exact receiver provenance`
                        );
                    }
                    if (!callEdgeInfo && !ordinaryVirtualDispatch && isUnresolvedVirtualDispatchCopyEdge(scene, node, targetNode)) {
                        log(`    [Copy-SKIP] Unresolved virtual dispatch copy ${node.getID()} -> ${targetNodeId} has no exact receiver evidence`);
                        continue;
                    }
                    if (fact.field && fact.field.length > 0 && !callEdgeInfo && !isOrdinaryFieldCarrierRelayCopy(node, targetNode)) {
                        continue;
                    }
                    let newCtx = currentCtx;

                    if (callEdgeInfo) {
                        if (callEdgeInfo.type === CallEdgeType.CALL) {
                            newCtx = ctxManager.createCalleeContext(
                                currentCtx,
                                callEdgeInfo.callSiteId,
                                callEdgeInfo.callerMethodName,
                                callEdgeInfo.calleeMethodName
                            );
                            log(`    [Call] ${callEdgeInfo.callerMethodName} -> ${callEdgeInfo.calleeMethodName}, ctx: ${currentCtx} -> ${newCtx}`);
                        } else if (callEdgeInfo.type === CallEdgeType.RETURN) {
                            const restoredCtx = resolveReturnEdgeContext(
                                ctxManager,
                                currentCtx,
                                callEdgeInfo.callSiteId,
                                { allowUnambiguousEmptyContext: allowUnambiguousEmptyReturn },
                            );
                            if (restoredCtx === undefined) {
                                const topElem = ctxManager.getTopElement(currentCtx);
                                log(`    [Return-SKIP] ${callEdgeInfo.calleeMethodName} -> ${callEdgeInfo.callerMethodName}, ctx top=${topElem} != callsite=${callEdgeInfo.callSiteId}`);
                                continue;
                            }
                            newCtx = restoredCtx;
                            log(`    [Return] ${callEdgeInfo.calleeMethodName} -> ${callEdgeInfo.callerMethodName}, ctx: ${currentCtx} -> ${newCtx}`);
                        }
                        const nodeStmt = (node as any).stmt;
                        const nodeInvokeExpr = nodeStmt?.containsInvokeExpr?.() ? nodeStmt.getInvokeExpr?.() : undefined;
                        const nodeMethodSig = nodeInvokeExpr?.getMethodSignature?.();
                        const pluginCallEdgeBatch = onCallEdge?.({
                            reason: callEdgeInfo.type === CallEdgeType.CALL ? "Call" : "Return",
                            edgeType: callEdgeInfo.type === CallEdgeType.CALL ? "call" : "return",
                            callSiteId: callEdgeInfo.callSiteId,
                            callerMethodName: callEdgeInfo.callerMethodName,
                            calleeMethodName: callEdgeInfo.calleeMethodName,
                            callSignature: nodeMethodSig?.toString?.() || "",
                            methodName: nodeMethodSig?.getMethodSubSignature?.()?.getMethodName?.() || "",
                            declaringClassName: nodeMethodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "",
                            args: nodeInvokeExpr?.getArgs ? nodeInvokeExpr.getArgs() : [],
                            baseValue: nodeInvokeExpr?.getBase ? nodeInvokeExpr.getBase() : undefined,
                            resultValue: nodeStmt instanceof ArkAssignStmt ? nodeStmt.getLeftOp?.() : undefined,
                            stmt: nodeStmt,
                            invokeExpr: nodeInvokeExpr,
                            sourceNodeId: node.getID(),
                            targetNodeId,
                            fromContextId: currentCtx,
                            toContextId: newCtx,
                            fact,
                        });
                        applyPluginPropagationBatch(pluginCallEdgeBatch, fact, currentChain, tryEnqueue);
                    }

                    if (
                        fact.field
                        && fact.field.length > 0
                        && callEdgeInfo
                        && callEdgeInfo.type === CallEdgeType.CALL
                        && !canCallTargetCarryNestedFieldPath(targetNode)
                    ) {
                        log(`    [Call-Field-SKIP] ${targetNodeId} cannot carry nested field path '${fact.field.join(".")}'`);
                        continue;
                    }

                    const newFact = new TaintFact(
                        targetNode,
                        fact.source,
                        newCtx,
                        fact.field ? [...fact.field] : undefined,
                    );
                    tryEnqueue("Copy", newFact, () => {
                        tracker.markTainted(targetNodeId, newCtx, fact.source, newFact.field, newFact.taintId);
                        log(`    [Copy] Tainted node ${targetNodeId} (from ${node.getID()}, ctx=${newCtx})`);
                    });
                }
            }

            if (!fact.field || fact.field.length === 0) {
                const sharedStateCtx = normalizeSharedStateContext(ctxManager, currentCtx);
                const writeEdges = node.getOutgoingWriteEdges();
                if (writeEdges) {
                    for (const edge of writeEdges) {
                        const fieldNode = pag.getNode(edge.getDstID());
                        const currentValue = node.getValue?.();
                        const fieldNodeStmt = (fieldNode as any)?.getStmt?.();
                        const rhsMatchesCurrentValue = fieldNodeStmt instanceof ArkAssignStmt
                            && fieldNodeStmt.getRightOp?.() === currentValue;
                        if (fieldNode instanceof PagStaticFieldNode) {
                            const newFact = new TaintFact(fieldNode as PagNode, fact.source, sharedStateCtx);
                            tryEnqueue("Store-StaticField", newFact, () => {
                                tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                                log(`    [Store-StaticField] Tainted static field node ${newFact.node.getID()} (ctx=${sharedStateCtx})`);
                            });
                            continue;
                        }

                        if (fieldNode instanceof PagArrayNode) {
                            if (!rhsMatchesCurrentValue) continue;
                            const arrayRef = fieldNode.getValue() as ArkArrayRef;
                            const slotKey = toContainerFieldKey(resolveOrdinaryArraySlotName(arrayRef.getIndex()));
                            const baseLocal = arrayRef.getBase();
                    const storeAnchorStmt = findStoreAnchorStmtForTaintedValue(node.getValue?.(), arrayRef)
                                || (fieldNode as any).getStmt?.()
                                || fact.node.getStmt?.();
                            const baseCarrierIds = collectCarrierNodeIdsForValueAtStmt(
                                pag,
                                baseLocal,
                                storeAnchorStmt,
                                classBySignature,
                            );
                            for (const carrierNodeId of baseCarrierIds) {
                                const carrierNode = pag.getNode(carrierNodeId) as PagNode;
                                if (!carrierNode) continue;
                                const newFact = new TaintFact(carrierNode, fact.source, currentCtx, [slotKey]);
                                tryEnqueue("Store-ArraySlot", newFact, () => {
                                    tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                                    log(`    [Store-ArraySlot] Tainted slot '${slotKey}' of Obj ${carrierNodeId} (ctx=${currentCtx})`);
                                });
                            }
                            continue;
                        }

                        if (!(fieldNode instanceof PagInstanceFieldNode)) continue;
                        if (!rhsMatchesCurrentValue) continue;

                        const fieldRef = fieldNode.getValue() as ArkInstanceFieldRef;
                        const fieldName = fieldRef.getFieldSignature().getFieldName();
                        const baseLocal = fieldRef.getBase();
                    const storeAnchorStmt = findStoreAnchorStmtForTaintedValue(node.getValue?.(), fieldRef)
                            || (fieldNode as any).getStmt?.()
                            || fact.node.getStmt?.();
                        const baseCarrierIds = collectCarrierNodeIdsForValueAtStmt(
                            pag,
                            baseLocal,
                            storeAnchorStmt,
                            classBySignature,
                        );
                        for (const carrierNodeId of baseCarrierIds) {
                            const carrierNode = pag.getNode(carrierNodeId) as PagNode;
                            if (!carrierNode) continue;
                            const newFact = new TaintFact(carrierNode, fact.source, currentCtx, [fieldName]);
                            tryEnqueue("Store", newFact, () => {
                                tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                                log(`    [Store] Tainted field '${fieldName}' of Obj ${carrierNodeId} (ctx=${currentCtx})`);
                            });
                        }
                    }
                }

                traceSection("field_propagation_engine", fact);
                const fieldEmissions = measureSection(
                    "field_propagation_engine",
                    () => fieldPropagationEngine.propagate({ fact, node, currentCtx }),
                );
                for (const emission of fieldEmissions) {
                    enqueueFieldEmission(emission);
                }
                const moduleStateFacts = collectOrdinaryModuleStateFactsFromTaintedLocal(
                    node,
                    fact.source,
                    sharedStateCtx,
                    pag,
                    ordinarySharedStateIndex,
                );
                for (const newFact of moduleStateFacts) {
                    tryEnqueue("Store-ModuleState", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                        log(`    [Store-ModuleState] Tainted node ${newFact.node.getID()} via module/shared state (ctx=${newFact.contextID})`);
                    });
                }

                const moduleImportBindingFacts = collectOrdinaryModuleImportBindingFactsFromTaintedLocal(
                    node,
                    fact.source,
                    currentCtx,
                    sharedStateCtx,
                    pag,
                    ordinarySharedStateIndex,
                );
                for (const newFact of moduleImportBindingFacts) {
                    tryEnqueue("Store-ModuleImportBinding", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                        log(`    [Store-ModuleImportBinding] Tainted node ${newFact.node.getID()} via explicit import binding (ctx=${newFact.contextID})`);
                    });
                }

                const staticSharedStateFacts = collectOrdinaryStaticSharedStateFactsFromTaintedNode(
                    node,
                    fact.source,
                    sharedStateCtx,
                    pag,
                    ordinarySharedStateIndex,
                );
                for (const newFact of staticSharedStateFacts) {
                    tryEnqueue("Load-StaticSharedState", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                        log(`    [Load-StaticSharedState] Tainted node ${newFact.node.getID()} via shared static/module state (ctx=${newFact.contextID})`);
                    });
                }
            }

            if (fact.field && fact.field.length > 0) {
                const sharedStateCtx = normalizeSharedStateContext(ctxManager, currentCtx);
                const receiverBridgeInfos = receiverFieldBridgeMap.get(node.getID());
                if (receiverBridgeInfos && receiverBridgeInfos.length > 0) {
                    const topElem = ctxManager.getTopElement(currentCtx);
                    for (const bridgeInfo of receiverBridgeInfos) {
                        if (topElem !== bridgeInfo.callSiteId) continue;
                        const targetNode = pag.getNode(bridgeInfo.targetCarrierNodeId) as PagNode;
                        if (!targetNode) continue;
                        const restoredCtx = ctxManager.restoreCallerContext(currentCtx);
                        const newFact = new TaintFact(targetNode, fact.source, restoredCtx, [...fact.field]);
                        tryEnqueue("Receiver-Field-WriteBack", newFact, () => {
                            tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                            log(
                                `    [Receiver-Field-WriteBack] ${bridgeInfo.calleeMethodName} -> ${bridgeInfo.callerMethodName}, `
                                + `node ${bridgeInfo.targetCarrierNodeId}.${fact.field?.join(".")} (ctx=${currentCtx} -> ${restoredCtx})`
                            );
                        });
                    }
                }

                const returnFieldFacts = collectReturnFieldWriteBackFacts(
                    pag,
                    callEdgeMap,
                    ctxManager,
                    node,
                    fact,
                    currentCtx,
                    classBySignature,
                );
                for (const newFact of returnFieldFacts) {
                    tryEnqueue("Return-Field-WriteBack", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                        log(
                            `    [Return-Field-WriteBack] node ${node.getID()}.${fact.field?.join(".")} `
                            + `-> ${newFact.node.getID()}.${newFact.field?.join(".")} (ctx=${currentCtx} -> ${newFact.contextID})`
                        );
                    });
                }

                const returnedPromiseContinuationFacts = collectReturnedPromiseContinuationFacts(
                    pag,
                    callEdgeMap,
                    ctxManager,
                    scene,
                    node,
                    fact,
                    currentCtx,
                    classBySignature,
                );
                for (const newFact of returnedPromiseContinuationFacts) {
                    tryEnqueue("Return-Promise-Continuation", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                        log(
                            `    [Return-Promise-Continuation] node ${node.getID()}.${fact.field?.join(".")} `
                            + `-> ${newFact.node.getID()}.${newFact.field?.join(".")} (ctx=${currentCtx} -> ${newFact.contextID})`
                        );
                    });
                }

                const callFieldFacts = collectCallFieldForwardFacts(
                    pag,
                    callEdgeMap,
                    ctxManager,
                    node,
                    fact,
                    currentCtx,
                    classBySignature,
                );
                for (const newFact of callFieldFacts) {
                    tryEnqueue("Call-Field-Forward", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                        log(
                            `    [Call-Field-Forward] node ${node.getID()}.${fact.field?.join(".")} `
                            + `-> ${newFact.node.getID()}.${newFact.field?.join(".")} (ctx=${currentCtx} -> ${newFact.contextID})`
                        );
                    });
                }

            }

            if (fact.field && fact.field.length > 0) {
                traceSection("field_propagation_engine", fact);
                const fieldEmissions = measureSection(
                    "field_propagation_engine",
                    () => fieldPropagationEngine.propagate({ fact, node, currentCtx }),
                );
                for (const emission of fieldEmissions) {
                    enqueueFieldEmission(emission);
                }
            }

            if (fact.field && fact.field.length > 0) {
                traceSection("receiver_local_field", fact);
                const sharedStateCtx = normalizeSharedStateContext(ctxManager, currentCtx);
                const writeEdges = node.getOutgoingWriteEdges();
                if (writeEdges) {
                    for (const edge of writeEdges) {
                        const fieldNode = pag.getNode(edge.getDstID());
                        if (!(fieldNode instanceof PagStaticFieldNode)) continue;
                        const newFact = new TaintFact(
                            fieldNode as PagNode,
                            fact.source,
                            sharedStateCtx,
                            [...fact.field],
                        );
                        tryEnqueue("Store-StaticField", newFact, () => {
                            tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                            log(`    [Store-StaticField] Tainted static field node ${newFact.node.getID()}.${newFact.field?.join(".")} (ctx=${sharedStateCtx})`);
                        });
                    }
                }

                const moduleStateFacts = collectOrdinaryModuleStateFactsFromTaintedLocal(
                    node,
                    fact.source,
                    sharedStateCtx,
                    pag,
                    ordinarySharedStateIndex,
                    fact.field,
                );
                for (const newFact of moduleStateFacts) {
                    tryEnqueue("Store-ModuleState", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                        log(`    [Store-ModuleState] Tainted node ${newFact.node.getID()}.${newFact.field?.join(".")} via module/shared state (ctx=${newFact.contextID})`);
                    });
                }

                const moduleImportBindingFacts = collectOrdinaryModuleImportBindingFactsFromTaintedLocal(
                    node,
                    fact.source,
                    currentCtx,
                    sharedStateCtx,
                    pag,
                    ordinarySharedStateIndex,
                    fact.field,
                );
                for (const newFact of moduleImportBindingFacts) {
                    tryEnqueue("Store-ModuleImportBinding", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                        log(`    [Store-ModuleImportBinding] Tainted node ${newFact.node.getID()}.${newFact.field?.join(".")} via explicit import binding (ctx=${newFact.contextID})`);
                    });
                }

                const staticSharedStateFacts = collectOrdinaryStaticSharedStateFactsFromTaintedNode(
                    node,
                    fact.source,
                    sharedStateCtx,
                    pag,
                    ordinarySharedStateIndex,
                    fact.field,
                );
                for (const newFact of staticSharedStateFacts) {
                    tryEnqueue("Load-StaticSharedState", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                        log(`    [Load-StaticSharedState] Tainted node ${newFact.node.getID()}.${newFact.field?.join(".")} via shared static/module state (ctx=${newFact.contextID})`);
                    });
                }
            }

        }
        worklist.length = 0;
        progressLog(`[worklist] solve loop done head=${queueHead} visited=${visited.size} elapsed_ms=${Date.now() - startedAt}`);
    }
}

function collectCanonicalModuleInvokeSitesByNode(
    apiEffectRuntimeIndex: ApiEffectRuntimeIndexLike | undefined,
    pag: Pag,
    allowedMethodSignatures: Set<string> | undefined,
    classBySignature?: Map<string, any>,
): Map<number, CanonicalModuleInvokeSite[]> {
    const out = new Map<number, CanonicalModuleInvokeSite[]>();
    if (!apiEffectRuntimeIndex) return out;
    const semanticSitesByOccurrenceKey = new Map<string, ReturnType<ApiEffectRuntimeIndexLike["listSemanticEffectSites"]>>();
    for (const semanticSite of apiEffectRuntimeIndex.listSemanticEffectSites()) {
        if (semanticSite.capability !== "module") continue;
        if (!semanticSite.canonicalApiId || !semanticSite.occurrenceId) continue;
        const key = `${semanticSite.occurrenceId}|${semanticSite.canonicalApiId}`;
        const current = semanticSitesByOccurrenceKey.get(key) || [];
        current.push(semanticSite);
        semanticSitesByOccurrenceKey.set(key, current);
    }
    const seen = new Set<string>();
    for (const site of apiEffectRuntimeIndex.listCanonicalOccurrenceSites()) {
        const resolved = site.resolvedOccurrence;
        if (!resolved || resolved.status !== "accepted" || !resolved.canonicalApiId) continue;
        if (!site.stmt?.containsInvokeExpr?.() || typeof site.stmt.getInvokeExpr !== "function") continue;
        if (!apiEffectRuntimeIndex.hasModuleSemanticAssetBinding(resolved.canonicalApiId)) continue;
        const ownerMethodSignature = site.method?.getSignature?.()?.toString?.() || "";
        if (allowedMethodSignatures && (!ownerMethodSignature || !allowedMethodSignatures.has(ownerMethodSignature))) {
            continue;
        }
        const invokeExpr = site.stmt.getInvokeExpr();
        if (!invokeExpr) continue;
        const key = `${resolved.occurrenceId}|${resolved.canonicalApiId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const methodSig = invokeExpr.getMethodSignature?.();
        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        const resultValue = site.stmt instanceof ArkAssignStmt ? site.stmt.getLeftOp?.() : undefined;
        const semanticEffectSites = semanticSitesByOccurrenceKey.get(key) || [];
        if (semanticEffectSites.length === 0) continue;
        const candidateNodeIds = new Set<number>();
        for (const semanticSite of semanticEffectSites) {
            const projection = projectSemanticEffectEndpoint({
                pag,
                semanticSite,
                endpointSpec: semanticSite.endpointSpec,
                stmt: site.stmt,
                invokeExpr,
                allowNodeCreation: false,
                consumer: "module",
            });
            if (!isConsumableSemanticEndpointProjection(projection)) continue;
            for (const nodeId of projection.nodeIds) {
                candidateNodeIds.add(nodeId);
            }
            for (const nodeId of projection.carrierNodeIds) {
                candidateNodeIds.add(nodeId);
            }
        }
        if (candidateNodeIds.size === 0) continue;
        const invokeSite: CanonicalModuleInvokeSite = {
            stmt: site.stmt,
            invokeExpr,
            callSignature: methodSig?.toString?.() || "",
            methodName: methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "",
            declaringClassName: methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "",
            canonicalApiId: resolved.canonicalApiId,
            occurrenceId: resolved.occurrenceId,
            rawOccurrenceId: resolved.rawOccurrenceId,
            semanticEffectSites,
            args,
            baseValue: invokeExpr.getBase ? invokeExpr.getBase() : undefined,
            resultValue,
        };
        for (const nodeId of candidateNodeIds) {
            const current = out.get(nodeId) || [];
            current.push(invokeSite);
            out.set(nodeId, current);
        }
    }
    return out;
}

interface ReturnFieldCandidate {
    dstNodeId: number;
    callEdgeInfo: CallEdgeInfo;
}

const MAX_RETURN_PROMISE_CONTINUATION_DEPTH = 8;

function collectReturnFieldCandidates(
    pag: Pag,
    callEdgeMap: Map<string, CallEdgeInfo>,
    carrierNode: PagNode,
    classBySignature?: Map<string, any>,
): ReturnFieldCandidate[] {
    const carrierNodeId = carrierNode.getID();
    const carrierMethodSignature = resolvePagNodeDeclaringMethodSignature(carrierNode);
    const out: ReturnFieldCandidate[] = [];
    const seen = new Set<string>();
    for (const aliasLocal of collectAliasLocalsForCarrier(pag, carrierNodeId, classBySignature)) {
        if (carrierMethodSignature && localDeclaringMethodSignature(aliasLocal) !== carrierMethodSignature) continue;
        const aliasNodes = pag.getNodesByValue(aliasLocal);
        if (!aliasNodes) continue;
        for (const srcNodeId of aliasNodes.values()) {
            const srcNode = pag.getNode(srcNodeId) as PagNode;
            const copyEdges = srcNode.getOutgoingCopyEdges()?.values();
            if (!copyEdges) continue;
            for (const edge of copyEdges) {
                const dstNodeId = edge.getDstID();
                const callEdgeInfo = callEdgeMap.get(`${srcNodeId}->${dstNodeId}`);
                if (!callEdgeInfo || callEdgeInfo.type !== CallEdgeType.RETURN) continue;
                const key = `${srcNodeId}->${dstNodeId}:${callEdgeInfo.callSiteId}`;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({ dstNodeId, callEdgeInfo });
            }
        }
    }
    return out;
}

function resolveReturnContinuationContext(
    ctxManager: TaintContextManager,
    currentCtx: number,
    callSiteId: number,
): number | undefined {
    const restoredCtx = ctxManager.restoreCallerContextForCallSite(currentCtx, callSiteId);
    if (restoredCtx !== undefined) return restoredCtx;
    return ctxManager.getTopElement(currentCtx) === -1 ? currentCtx : undefined;
}

function collectReturnedPromiseContinuationFacts(
    pag: Pag,
    callEdgeMap: Map<string, CallEdgeInfo>,
    ctxManager: TaintContextManager,
    scene: Scene,
    carrierNode: PagNode,
    fact: TaintFact,
    currentCtx: number,
    classBySignature?: Map<string, any>,
): TaintFact[] {
    if (!fact.field || fact.field.length === 0) return [];

    const trace = process.env.ARKTAINT_TRACE_RETURN_PROMISE_CONTINUATION === "1";
    const out: TaintFact[] = [];
    const seenFacts = new Set<string>();
    const visited = new Set<string>();
    const initialCandidates = collectReturnFieldCandidates(pag, callEdgeMap, carrierNode, classBySignature);
    if (trace) {
        console.log(
            `[ReturnPromiseContinuation] start carrier=${carrierNode.getID()} field=${fact.field.join(".")} `
            + `ctx=${currentCtx} initial=${initialCandidates.length}`
        );
    }
    const queue: Array<ReturnFieldCandidate & { sourceCtx: number; depth: number }> =
        initialCandidates.map(candidate => ({ ...candidate, sourceCtx: currentCtx, depth: 0 }));

    const addFact = (newFact: TaintFact): void => {
        const key = `${newFact.id}\u0001${newFact.source}`;
        if (seenFacts.has(key)) return;
        seenFacts.add(key);
        out.push(newFact);
    };

    while (queue.length > 0) {
        const current = queue.shift()!;
        const targetCtx = resolveReturnContinuationContext(
            ctxManager,
            current.sourceCtx,
            current.callEdgeInfo.callSiteId,
        );
        if (targetCtx === undefined) continue;

        const visitKey = `${current.dstNodeId}@${targetCtx}:${current.depth}`;
        if (visited.has(visitKey)) continue;
        visited.add(visitKey);

        const targetNode = pag.getNode(current.dstNodeId) as PagNode;
        if (!targetNode) continue;

        const awaitFacts = collectOrdinaryAwaitResultFactsFromTaintedLocal(
            targetNode,
            fact.source,
            targetCtx,
            pag,
            fact.field,
        );
        for (const awaitFact of awaitFacts) {
            addFact(awaitFact);
        }

        const callbackParamNodeIds = collectOrdinaryPromiseThenCallbackParamNodeIdsFromTaintedLocal(
            targetNode,
            pag,
            scene,
        );
        if (trace) {
            const stmt = (targetNode as any).getStmt?.() || (targetNode as any).stmt;
            console.log(
                `[ReturnPromiseContinuation] visit depth=${current.depth} target=${current.dstNodeId} `
                + `ctx=${targetCtx} callsite=${current.callEdgeInfo.callSiteId} await=${awaitFacts.length} `
                + `then=${callbackParamNodeIds.length} stmt=${stmt?.toString?.() || ""}`
            );
        }
        for (const callbackParamNodeId of callbackParamNodeIds) {
            const callbackParamNode = pag.getNode(callbackParamNodeId) as PagNode;
            if (!callbackParamNode) continue;
            addFact(new TaintFact(callbackParamNode, fact.source, targetCtx, [...fact.field]));
        }

        if (current.depth >= MAX_RETURN_PROMISE_CONTINUATION_DEPTH) continue;
        const nextCandidates = collectReturnFieldCandidates(
            pag,
            callEdgeMap,
            targetNode,
            classBySignature,
        );
        if (trace && nextCandidates.length > 0) {
            console.log(
                `[ReturnPromiseContinuation] recurse target=${current.dstNodeId} next=${nextCandidates.length}`
            );
        }
        for (const nextCandidate of nextCandidates) {
            queue.push({
                ...nextCandidate,
                sourceCtx: targetCtx,
                depth: current.depth + 1,
            });
        }
    }

    return out;
}

function collectReturnFieldWriteBackFacts(
    pag: Pag,
    callEdgeMap: Map<string, CallEdgeInfo>,
    ctxManager: TaintContextManager,
    carrierNode: PagNode,
    fact: TaintFact,
    currentCtx: number,
    classBySignature?: Map<string, any>,
): TaintFact[] {
    if (!fact.field || fact.field.length === 0) return [];

    const out: TaintFact[] = [];
    const seen = new Set<string>();
    const returnCandidates = collectReturnFieldCandidates(pag, callEdgeMap, carrierNode, classBySignature);

    const allowUnambiguousEmptyReturn = canResolveEmptyContextReturnExactly(
        ctxManager,
        currentCtx,
        returnCandidates.map(candidate => candidate.callEdgeInfo),
    );
    for (const candidate of returnCandidates) {
        const restoredCtx = resolveReturnEdgeContext(
            ctxManager,
            currentCtx,
            candidate.callEdgeInfo.callSiteId,
            { allowUnambiguousEmptyContext: allowUnambiguousEmptyReturn },
        );
        if (restoredCtx === undefined) continue;
        const targetNode = pag.getNode(candidate.dstNodeId) as PagNode;
        if (!targetNode) continue;
        const newFact = new TaintFact(targetNode, fact.source, restoredCtx, [...fact.field]);
        const key = `${newFact.id}\u0001${newFact.source}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(newFact);
    }
    return out;
}

function collectCallFieldForwardFacts(
    pag: Pag,
    callEdgeMap: Map<string, CallEdgeInfo>,
    ctxManager: TaintContextManager,
    carrierNode: PagNode,
    fact: TaintFact,
    currentCtx: number,
    classBySignature?: Map<string, any>,
): TaintFact[] {
    if (!fact.field || fact.field.length === 0) return [];

    const out: TaintFact[] = [];
    const seen = new Set<string>();
    const carrierNodeId = carrierNode.getID();
    const carrierMethodSignature = resolvePagNodeDeclaringMethodSignature(carrierNode);
    for (const aliasLocal of collectAliasLocalsForCarrier(pag, carrierNodeId, classBySignature)) {
        if (carrierMethodSignature && localDeclaringMethodSignature(aliasLocal) !== carrierMethodSignature) continue;
        const aliasNodes = pag.getNodesByValue(aliasLocal);
        if (!aliasNodes) continue;
        for (const srcNodeId of aliasNodes.values()) {
            const srcNode = pag.getNode(srcNodeId) as PagNode;
            const copyEdges = srcNode.getOutgoingCopyEdges()?.values();
            if (!copyEdges) continue;
            for (const edge of copyEdges) {
                const dstNodeId = edge.getDstID();
                const callEdgeInfo = callEdgeMap.get(`${srcNodeId}->${dstNodeId}`);
                if (!callEdgeInfo || callEdgeInfo.type !== CallEdgeType.CALL) continue;
                const targetNode = pag.getNode(dstNodeId) as PagNode;
                if (!targetNode) continue;
                if (!canCallTargetCarryNestedFieldPath(targetNode)) continue;
                const nextCtx = ctxManager.createCalleeContext(
                    currentCtx,
                    callEdgeInfo.callSiteId,
                    callEdgeInfo.callerMethodName,
                    callEdgeInfo.calleeMethodName,
                );
                const newFact = new TaintFact(targetNode, fact.source, nextCtx, [...fact.field]);
                const key = `${newFact.id}\u0001${newFact.source}`;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push(newFact);
            }
        }
    }
    return out;
}

function localDeclaringMethodSignature(local: Local): string {
    return local.getDeclaringStmt?.()
        ?.getCfg?.()
        ?.getDeclaringMethod?.()
        ?.getSignature?.()
        ?.toString?.() || "";
}

interface ExactOrdinaryVirtualDispatchCopy {
    ownerName: string;
    methodName: string;
}

function collectExactOrdinaryVirtualDispatchParamFacts(
    scene: Scene,
    pag: Pag,
    taintedNode: PagNode,
    source: string,
    currentCtx: number,
    fieldPath?: string[],
): TaintFact[] {
    const results: TaintFact[] = [];
    const seen = new Set<string>();
    const sourceValue = taintedNode.getValue?.();
    if (!sourceValue) return results;
    const sourceMethodSig = resolvePagNodeDeclaringMethodSignature(taintedNode);
    const sourceCfg = taintedNode.getStmt?.()?.getCfg?.()
        || (sourceValue as any)?.getDeclaringStmt?.()?.getCfg?.()
        || (sourceMethodSig ? getMethodBySignature(scene, sourceMethodSig)?.getCfg?.() : undefined);
    if (!sourceCfg) return results;

    for (const stmt of sourceCfg.getStmts?.() || []) {
        if (!stmt.containsInvokeExpr?.()) continue;
        const invokeExpr = stmt.getInvokeExpr?.();
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
        const gap = diagnoseUnresolvedVirtualDispatchCached(scene, invokeExpr);
        if (!gap || !gap.methodName) continue;

        const args = invokeExpr.getArgs?.() || [];
        const argIndex = args.findIndex((arg: any) => isSameUnresolvedVirtualArgument(sourceCfg, sourceValue, arg));
        if (argIndex < 0) continue;

        const ownerNames = resolveExactConcreteOwnerNamesForValue(
            scene,
            invokeExpr.getBase?.(),
            stmt,
            new Set<string>(),
        );
        if (!ownerNames || ownerNames.size !== 1) continue;
        const ownerName = [...ownerNames][0];
        const callee = resolveUniqueConcreteMethod(scene, ownerName, gap.methodName, args.length);
        if (!callee) continue;

        const targetParamStmt = resolveConcreteCalleeParamForArg(callee, argIndex, true);
        if (!targetParamStmt) continue;
        const targetNodeIds = resolveParamNodeIds(pag, targetParamStmt);
        for (const targetNodeId of targetNodeIds) {
            const targetNode = pag.getNode(targetNodeId) as PagNode;
            if (!targetNode) continue;
            const fact = new TaintFact(
                targetNode,
                source,
                currentCtx,
                fieldPath && fieldPath.length > 0 ? [...fieldPath] : undefined,
            );
            const key = `${fact.id}\u0001${fact.source}`;
            if (seen.has(key)) continue;
            seen.add(key);
            results.push(fact);
        }
    }

    return results;
}

function resolveExactOrdinaryVirtualDispatchCopy(
    scene: Scene,
    sourceNode: PagNode,
    targetNode: PagNode,
): ExactOrdinaryVirtualDispatchCopy | undefined {
    const sourceMethod = resolvePagNodeDeclaringMethodSignature(sourceNode);
    const targetMethod = resolvePagNodeDeclaringMethodSignature(targetNode);
    if (!sourceMethod || !targetMethod || sourceMethod === targetMethod) return undefined;

    const sourceValue = sourceNode.getValue?.();
    if (!sourceValue) return undefined;
    const sourceCfg = sourceNode.getStmt?.()?.getCfg?.()
        || (sourceValue as any)?.getDeclaringStmt?.()?.getCfg?.();
    if (!sourceCfg) return undefined;

    const targetMethodName = targetNode.getStmt?.()?.getCfg?.()?.getDeclaringMethod?.()?.getName?.()
        || (targetNode.getValue?.() as any)?.getDeclaringStmt?.()?.getCfg?.()?.getDeclaringMethod?.()?.getName?.()
        || "";
    if (!targetMethodName) return undefined;

    const targetOwnerNames = resolveMethodOwnerNameCandidates(targetMethod);
    if (targetOwnerNames.size === 0) return undefined;

    for (const stmt of sourceCfg.getStmts?.() || []) {
        if (!stmt.containsInvokeExpr?.()) continue;
        const invokeExpr = stmt.getInvokeExpr?.();
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
        const gap = diagnoseUnresolvedVirtualDispatchCached(scene, invokeExpr);
        if (!gap || gap.methodName !== targetMethodName) continue;
        const args = invokeExpr.getArgs?.() || [];
        if (!args.some((arg: any) => isSameUnresolvedVirtualArgument(sourceCfg, sourceValue, arg))) {
            continue;
        }

        const ownerNames = resolveExactConcreteOwnerNamesForValue(
            scene,
            invokeExpr.getBase?.(),
            stmt,
            new Set<string>(),
        );
        if (!ownerNames || ownerNames.size !== 1) continue;
        const ownerName = [...ownerNames][0];
        if (!ownerNameMatchesAny(ownerName, targetOwnerNames)) continue;
        return {
            ownerName,
            methodName: targetMethodName,
        };
    }
    return undefined;
}

function diagnoseUnresolvedVirtualDispatchCached(
    scene: Scene,
    invokeExpr: any,
): ReturnType<typeof diagnoseUnresolvedVirtualDispatch> {
    if (!invokeExpr || typeof invokeExpr !== "object") {
        return diagnoseUnresolvedVirtualDispatch(scene, invokeExpr);
    }
    let byInvoke = unresolvedVirtualDispatchDiagnosticCache.get(scene);
    if (!byInvoke) {
        byInvoke = new WeakMap<object, ReturnType<typeof diagnoseUnresolvedVirtualDispatch>>();
        unresolvedVirtualDispatchDiagnosticCache.set(scene, byInvoke);
    }
    const cached = byInvoke.get(invokeExpr);
    if (cached !== undefined || byInvoke.has(invokeExpr)) {
        return cached;
    }
    const result = diagnoseUnresolvedVirtualDispatch(scene, invokeExpr);
    byInvoke.set(invokeExpr, result);
    return result;
}

function resolveUniqueConcreteMethod(
    scene: Scene,
    ownerName: string,
    methodName: string,
    argCount: number,
): any | undefined {
    const candidates = getConcreteMethodCandidatesByName(scene).get(methodName) || [];
    const matches = candidates
        .filter(candidate => ownerNameMatchesAny(ownerName, candidate.ownerNames))
        .filter(candidate => isConcreteMethodArgCountConsistent(candidate.method, argCount));
    return matches.length === 1 ? matches[0].method : undefined;
}

function getConcreteMethodCandidatesByName(scene: Scene): Map<string, ConcreteMethodCandidate[]> {
    const cached = concreteMethodCandidatesByNameCache.get(scene);
    if (cached) return cached;

    const index = new Map<string, ConcreteMethodCandidate[]>();
    for (const method of scene.getMethods()) {
        if (!method?.getCfg?.()) continue;
        const methodName = method.getName?.() || "";
        if (!methodName) continue;
        const ownerNames = resolveMethodOwnerNameCandidates(method.getSignature?.()?.toString?.() || "");
        if (!index.has(methodName)) index.set(methodName, []);
        index.get(methodName)!.push({ method, ownerNames });
    }
    concreteMethodCandidatesByNameCache.set(scene, index);
    return index;
}

function isConcreteMethodArgCountConsistent(method: any, argCount: number): boolean {
    const paramStmts = collectConcreteParameterAssignStmts(method);
    if (paramStmts.length === argCount) return true;
    if (paramStmts.length === argCount + 1) {
        const firstParam = paramStmts[0].getRightOp?.();
        return firstParam instanceof ArkParameterRef && firstParam.getIndex?.() === 0;
    }
    return paramStmts.length === 1 && argCount > 1;
}

function resolveConcreteCalleeParamForArg(
    method: any,
    argIndex: number,
    isInstanceInvoke: boolean,
): ArkAssignStmt | undefined {
    const paramStmts = collectConcreteParameterAssignStmts(method);
    if (paramStmts.length === 0) return undefined;
    let targetIndex = argIndex;
    if (isInstanceInvoke && paramStmts.length === argIndex + 2) {
        const firstParam = paramStmts[0].getRightOp?.();
        if (firstParam instanceof ArkParameterRef && firstParam.getIndex?.() === 0) {
            targetIndex = argIndex + 1;
        }
    }
    if (targetIndex < paramStmts.length) return paramStmts[targetIndex];
    if (paramStmts.length === 1 && argIndex >= 0) return paramStmts[0];
    return undefined;
}

function collectConcreteParameterAssignStmts(method: any): ArkAssignStmt[] {
    if (method && typeof method === "object") {
        const cached = concreteParameterAssignStmtCache.get(method);
        if (cached) return cached;
    }
    const cfg = method?.getCfg?.();
    if (!cfg) return [];
    const paramStmts = cfg.getStmts()
        .filter((stmt: any) => stmt instanceof ArkAssignStmt && stmt.getRightOp?.() instanceof ArkParameterRef)
        .sort((left: ArkAssignStmt, right: ArkAssignStmt) => {
            const leftIndex = (left.getRightOp() as ArkParameterRef).getIndex();
            const rightIndex = (right.getRightOp() as ArkParameterRef).getIndex();
            return leftIndex - rightIndex;
        });
    if (method && typeof method === "object") {
        concreteParameterAssignStmtCache.set(method, paramStmts);
    }
    return paramStmts;
}

function resolveParamNodeIds(pag: Pag, paramStmt: ArkAssignStmt): number[] {
    const out = new Set<number>();
    const addNodes = (value: any, materialize: boolean): void => {
        let nodes = pag.getNodesByValue(value);
        if ((!nodes || nodes.size === 0) && materialize) {
            nodes = materializeExactPagNodes(pag, value, paramStmt, 0);
        }
        if (!nodes) return;
        for (const nodeId of nodes.values()) out.add(nodeId);
    };
    addNodes(paramStmt.getRightOp?.(), true);
    const leftOp = paramStmt.getLeftOp?.();
    addNodes(leftOp, true);
    if (leftOp instanceof Local) {
        for (const useStmt of leftOp.getUsedStmts?.() || []) {
            const nodes = materializeExactPagNodes(pag, leftOp, useStmt, 0);
            if (!nodes) continue;
            for (const nodeId of nodes.values()) out.add(nodeId);
        }
    }
    return [...out];
}

function isUnresolvedVirtualDispatchCopyEdge(scene: Scene, sourceNode: PagNode, targetNode: PagNode): boolean {
    const sourceMethod = resolvePagNodeDeclaringMethodSignature(sourceNode);
    const targetMethod = resolvePagNodeDeclaringMethodSignature(targetNode);
    if (!sourceMethod || !targetMethod || sourceMethod === targetMethod) return false;

    const sourceValue = sourceNode.getValue?.();
    if (!sourceValue) return false;
    const sourceCfg = sourceNode.getStmt?.()?.getCfg?.()
        || (sourceValue as any)?.getDeclaringStmt?.()?.getCfg?.();
    const targetDeclaringMethodName = targetNode.getStmt?.()?.getCfg?.()?.getDeclaringMethod?.()?.getName?.()
        || (targetNode.getValue?.() as any)?.getDeclaringStmt?.()?.getCfg?.()?.getDeclaringMethod?.()?.getName?.()
        || "";
    if (!sourceCfg || !targetDeclaringMethodName) return false;

    for (const stmt of sourceCfg.getStmts?.() || []) {
        if (!stmt.containsInvokeExpr?.()) continue;
        const invokeExpr = stmt.getInvokeExpr?.();
        const gap = diagnoseUnresolvedVirtualDispatchCached(scene, invokeExpr);
        if (!gap || gap.methodName !== targetDeclaringMethodName) continue;
        const args = invokeExpr?.getArgs?.() || [];
        if (args.some((arg: any) => isSameUnresolvedVirtualArgument(sourceCfg, sourceValue, arg))) {
            return true;
        }
    }
    return false;
}

function resolveExactConcreteOwnerNamesForValue(
    scene: Scene,
    value: any,
    anchorStmt: any,
    visiting: Set<string>,
): Set<string> | undefined {
    if (!value) return undefined;
    if (visiting.size > 12) return undefined;

    if (value instanceof ArkNewExpr) {
        const ownerName = resolveOwnerNameFromTypeText(value.getType?.()?.toString?.() || "")
            || resolveOwnerNameFromNewText(value.toString?.() || "");
        return singletonOwnerSet(ownerName);
    }
    if (value instanceof ArkCastExpr) {
        return resolveExactConcreteOwnerNamesForValue(scene, value.getOp?.(), anchorStmt, visiting);
    }
    if (value instanceof ArkAwaitExpr) {
        return resolveExactConcreteOwnerNamesForValue(scene, value.getPromise?.(), anchorStmt, visiting);
    }
    if (value instanceof ArkInstanceFieldRef) {
        return resolveExactThisFieldOwnerNames(scene, value, anchorStmt, visiting);
    }
    if (value instanceof ArkInstanceInvokeExpr || value instanceof ArkStaticInvokeExpr) {
        return resolveExactFactoryReturnOwnerNames(scene, value, visiting);
    }
    if (value instanceof Local) {
        const key = `local:${value.getName?.() || ""}:${value.getDeclaringStmt?.()?.toString?.() || ""}`;
        if (visiting.has(key)) return undefined;
        visiting.add(key);
        try {
            const directDecl = value.getDeclaringStmt?.();
            const assignStmt = directDecl instanceof ArkAssignStmt && isSameRelaySourceValue(directDecl.getLeftOp?.(), value)
                ? directDecl
                : findLatestAssignStmtForLocalBefore(value, anchorStmt);
            if (!(assignStmt instanceof ArkAssignStmt) || !isSameRelaySourceValue(assignStmt.getLeftOp?.(), value)) {
                return undefined;
            }
            return resolveExactConcreteOwnerNamesForValue(scene, assignStmt.getRightOp?.(), assignStmt, visiting);
        } finally {
            visiting.delete(key);
        }
    }
    return undefined;
}

function resolveExactFactoryReturnOwnerNames(
    scene: Scene,
    invokeExpr: ArkInstanceInvokeExpr | ArkStaticInvokeExpr,
    visiting: Set<string>,
): Set<string> | undefined {
    const methodSig = invokeExpr.getMethodSignature?.()?.toString?.() || "";
    if (!methodSig || methodSig.includes("%unk")) return undefined;
    const callee = getMethodBySignature(scene, methodSig);
    if (!callee?.getCfg?.()) return undefined;

    const calleeKey = `factory:${methodSig}`;
    if (visiting.has(calleeKey)) return undefined;
    visiting.add(calleeKey);
    try {
        const owners = new Set<string>();
        for (const retStmt of callee.getReturnStmt?.() || []) {
            if (!(retStmt instanceof ArkReturnStmt)) continue;
            const returnedOwners = resolveExactConcreteOwnerNamesForValue(
                scene,
                retStmt.getOp?.(),
                retStmt,
                visiting,
            );
            if (!returnedOwners || returnedOwners.size === 0) return undefined;
            for (const owner of returnedOwners) owners.add(owner);
        }
        return owners.size === 1 ? owners : undefined;
    } finally {
        visiting.delete(calleeKey);
    }
}

function resolveExactThisFieldOwnerNames(
    scene: Scene,
    fieldRef: ArkInstanceFieldRef,
    anchorStmt: any,
    visiting: Set<string>,
): Set<string> | undefined {
    const base = fieldRef.getBase?.();
    if (!(base instanceof Local) || base.getName?.() !== "this") return undefined;
    const fieldName = fieldRef.getFieldSignature?.().getFieldName?.() || fieldRef.getFieldName?.();
    if (!fieldName) return undefined;
    const method = anchorStmt?.getCfg?.()?.getDeclaringMethod?.();
    const arkClass = method?.getDeclaringArkClass?.();
    if (!arkClass) return undefined;

    const classSig = arkClass.getSignature?.()?.toString?.() || "";
    const key = `field:${classSig}:${fieldName}`;
    if (visiting.has(key)) return undefined;
    visiting.add(key);
    try {
        const owners = new Set<string>();
        for (const field of arkClass.getFields?.() || []) {
            const candidateName = field?.getSignature?.()?.getFieldName?.() || field?.getName?.();
            if (candidateName !== fieldName) continue;
            mergeOwnerSets(owners, resolveOwnerNamesFromFieldInitializer(field));
        }
        for (const methodCandidate of arkClass.getMethods?.() || []) {
            const cfg = methodCandidate?.getCfg?.();
            if (!cfg) continue;
            for (const stmt of cfg.getStmts?.() || []) {
                if (!(stmt instanceof ArkAssignStmt)) continue;
                const left = stmt.getLeftOp?.();
                if (!isThisFieldRefNamed(left, fieldName)) continue;
                const rightOwners = resolveExactConcreteOwnerNamesForValue(scene, stmt.getRightOp?.(), stmt, visiting);
                if (!rightOwners || rightOwners.size === 0) return undefined;
                mergeOwnerSets(owners, rightOwners);
            }
        }
        return owners.size === 1 ? owners : undefined;
    } finally {
        visiting.delete(key);
    }
}

function resolveOwnerNamesFromFieldInitializer(field: any): Set<string> | undefined {
    const initializer = field?.getInitializer?.();
    if (!initializer) return undefined;
    if (initializer instanceof ArkNewExpr) {
        return singletonOwnerSet(resolveOwnerNameFromTypeText(initializer.getType?.()?.toString?.() || initializer.toString?.() || ""));
    }
    const text = initializer.toString?.() || "";
    const owner = resolveOwnerNameFromNewText(text);
    return singletonOwnerSet(owner);
}

function isThisFieldRefNamed(value: any, fieldName: string): boolean {
    if (!(value instanceof ArkInstanceFieldRef)) return false;
    const base = value.getBase?.();
    if (!(base instanceof Local) || base.getName?.() !== "this") return false;
    const currentName = value.getFieldSignature?.().getFieldName?.() || value.getFieldName?.();
    return currentName === fieldName;
}

function mergeOwnerSets(target: Set<string>, source: Set<string> | undefined): void {
    if (!source) return;
    for (const item of source) target.add(item);
}

function singletonOwnerSet(ownerName: string | undefined): Set<string> | undefined {
    return ownerName ? new Set([ownerName]) : undefined;
}

function resolveMethodOwnerNameCandidates(methodSignature: string): Set<string> {
    const out = new Set<string>();
    const owner = extractOwnerNameFromMethodSignature(methodSignature);
    if (!owner) return out;
    out.add(owner);
    const simple = normalizeOwnerNameForDispatch(owner);
    if (simple) out.add(simple);
    return out;
}

function ownerNameMatchesAny(ownerName: string, candidates: Set<string>): boolean {
    const normalized = normalizeOwnerNameForDispatch(ownerName);
    for (const candidate of candidates) {
        if (ownerName === candidate) return true;
        if (normalized && normalized === normalizeOwnerNameForDispatch(candidate)) return true;
    }
    return false;
}

function isSyntheticReceiverOwnerContextAllowed(
    edge: SyntheticInvokeEdgeInfo,
    currentCtx: number,
    ctxManager: TaintContextManager,
    receiverOwnerNameByCallSiteId: Map<number, string>,
): boolean {
    const requiredOwner = edge.receiverOwnerName;
    if (!requiredOwner) return true;

    const callerOwnerCandidates = resolveMethodOwnerNameCandidates(edge.callerSignature || "");
    const topCallSiteId = ctxManager.getTopElement(currentCtx);
    if (topCallSiteId !== -1) {
        const contextOwner = receiverOwnerNameByCallSiteId.get(topCallSiteId);
        if (contextOwner && ownerNameMatchesAny(requiredOwner, new Set([contextOwner]))) {
            return true;
        }
        return ownerNameMatchesAny(requiredOwner, callerOwnerCandidates);
    }

    return ownerNameMatchesAny(requiredOwner, callerOwnerCandidates);
}

function valueCarriesCurrentFactTaint(
    value: any,
    anchorStmt: any,
    pag: Pag,
    tracker: TaintTracker,
    source: string,
    fieldPath: string[] | undefined,
    classBySignature?: Map<string, any>,
): boolean {
    if (value === undefined || value === null || value instanceof Constant) return false;
    const carrierNodeIds = collectCarrierNodeIdsForValueAtStmt(pag, value, anchorStmt, classBySignature);
    for (const carrierNodeId of carrierNodeIds) {
        if (tracker.getSourcesAnyContext(carrierNodeId, fieldPath).includes(source)) {
            return true;
        }
    }
    return false;
}

function canConstructorStoreSourceCarryNestedFieldPath(sourceNode: PagNode | undefined): boolean {
    return canCallTargetCarryNestedFieldPath(sourceNode);
}

function canCallTargetCarryNestedFieldPath(sourceNode: PagNode | undefined): boolean {
    if (!sourceNode) return false;
    if (sourceNode instanceof PagArrayNode || sourceNode instanceof PagInstanceFieldNode || sourceNode instanceof PagStaticFieldNode) {
        return true;
    }
    for (const _objId of sourceNode.getPointTo?.() || []) {
        return true;
    }
    if (resolveObjectClassSignatureByNode(sourceNode)) {
        return true;
    }
    const value: any = sourceNode.getValue?.();
    const typeText = value?.getType?.()?.toString?.() || "";
    if (!typeText) return false;
    const normalized = typeText.trim();
    if (/^(string|number|boolean|bigint|symbol|null|undefined|void|any|unknown)$/i.test(normalized)) {
        return false;
    }
    if (isGenericTypeParameterCarrier(normalized)) {
        return true;
    }
    if (normalized.includes("%unk")) {
        return false;
    }
    if (/\b(Array|Map|Set|Record|Object|Promise)\b/.test(normalized)) {
        return true;
    }
    return normalized.includes("@");
}

function isGenericTypeParameterCarrier(normalizedTypeText: string): boolean {
    return /^[A-Z]$/.test(normalizedTypeText);
}

function extractOwnerNameFromMethodSignature(methodSignature: string): string | undefined {
    const text = String(methodSignature || "");
    const openIdx = text.indexOf("(");
    const methodDotIdx = text.lastIndexOf(".", openIdx >= 0 ? openIdx : text.length);
    if (methodDotIdx < 0) return undefined;
    const colonIdx = text.lastIndexOf(":", methodDotIdx);
    const owner = text.slice(colonIdx >= 0 ? colonIdx + 1 : 0, methodDotIdx).replace(/\[static\]/g, "").trim();
    return owner || undefined;
}

function resolveOwnerNameFromTypeText(raw: string): string | undefined {
    const text = String(raw || "").trim();
    if (!text || text.includes("%unk")) return undefined;
    const classSigMatch = text.match(/@[^:>]+:\s*([A-Za-z_$][A-Za-z0-9_$]*)/);
    if (classSigMatch?.[1]) return classSigMatch[1];
    const genericMatch = text.match(/\b([A-Z][A-Za-z0-9_$]*)\s*(?:<|$)/);
    return genericMatch?.[1];
}

function resolveOwnerNameFromNewText(raw: string): string | undefined {
    const text = String(raw || "").trim();
    const matched = text.match(/\bnew\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/);
    return matched?.[1] || resolveOwnerNameFromTypeText(text);
}

function normalizeOwnerNameForDispatch(raw: string): string {
    const text = String(raw || "").replace(/\[static\]/g, "").trim();
    if (!text) return "";
    const slashIdx = text.lastIndexOf("/");
    const dotIdx = text.lastIndexOf(".");
    const colonIdx = text.lastIndexOf(":");
    const cutIdx = Math.max(slashIdx, dotIdx, colonIdx);
    return cutIdx >= 0 ? text.slice(cutIdx + 1).trim() : text;
}

function findLatestAssignStmtForLocalBefore(local: Local, anchorStmt: any): ArkAssignStmt | undefined {
    const cfg = anchorStmt?.getCfg?.() || local.getDeclaringStmt?.()?.getCfg?.();
    const stmts = cfg?.getStmts?.();
    if (!stmts) return undefined;

    let latest: ArkAssignStmt | undefined;
    for (const stmt of stmts) {
        if (stmt === anchorStmt) {
            if (stmt instanceof ArkAssignStmt && isSameRelaySourceValue(stmt.getLeftOp?.(), local)) {
                latest = stmt;
            }
            break;
        }
        if (!(stmt instanceof ArkAssignStmt)) continue;
        if (!isSameRelaySourceValue(stmt.getLeftOp?.(), local)) continue;
        latest = stmt;
    }
    return latest;
}

function isSameUnresolvedVirtualArgument(sourceCfg: any, sourceValue: any, arg: any): boolean {
    if (isSameRelaySourceValue(sourceValue, arg)) return true;
    if (sourceValue instanceof ArkParameterRef && arg instanceof Local) {
        const argDecl = arg.getDeclaringStmt?.();
        if (argDecl instanceof ArkAssignStmt && isSameRelaySourceValue(argDecl.getRightOp?.(), sourceValue)) {
            return true;
        }
    }
    if (sourceValue instanceof Local && arg instanceof ArkParameterRef) {
        const sourceDecl = sourceValue.getDeclaringStmt?.();
        if (sourceDecl instanceof ArkAssignStmt && isSameRelaySourceValue(sourceDecl.getRightOp?.(), arg)) {
            return true;
        }
    }
    for (const stmt of sourceCfg?.getStmts?.() || []) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp?.();
        const right = stmt.getRightOp?.();
        if (isSameRelaySourceValue(left, arg) && isSameRelaySourceValue(right, sourceValue)) return true;
        if (isSameRelaySourceValue(right, arg) && isSameRelaySourceValue(left, sourceValue)) return true;
    }
    return false;
}

function resolvePagNodeDeclaringMethodSignature(node: PagNode): string | undefined {
    const stmtMethodSig = node.getStmt?.()?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.();
    if (stmtMethodSig) return stmtMethodSig;
    return (node.getValue?.() as any)?.getDeclaringStmt?.()?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.();
}
