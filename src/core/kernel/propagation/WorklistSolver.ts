import { ArkArrayRef, ArkInstanceFieldRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { Pag, PagArrayNode, PagInstanceFieldNode, PagNode, PagStaticFieldNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { Constant } from "../../../../arkanalyzer/out/src/core/base/Constant";
import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { ArkMethod } from "../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { ArkParameterRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { TaintFact } from "../model/TaintFact";
import { TaintTracker } from "../model/TaintTracker";
import { FactPredecessorRecord } from "./PropagationTypes";
import type { CurrentnessCertificate } from "../oclfs";
import { FieldAccessIndex, FieldPropagationEngine } from "../field";
import { TaintContextManager, CallEdgeInfo, CallEdgeType } from "../context/TaintContext";
import { propagateExpressionTaint } from "./ExpressionPropagation";
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
import { toContainerFieldKey } from "../model/ContainerSlotKeys";
import { getMethodBySignature } from "../contracts/MethodLookup";
import {
    collectAliasLocalsForCarrier,
    collectCarrierNodeIdsForValueAtStmt,
} from "../ordinary/OrdinaryAliasPropagation";
import {
    collectOrdinaryArrayConstructorEffectsFromTaintedLocal,
    collectOrdinaryArrayFromMapperCallbackParamNodeIdsFromTaintedLocal,
    collectOrdinaryArrayHigherOrderEffectsFromTaintedLocal,
    collectOrdinaryArrayMutationEffectsFromTaintedLocal,
    collectOrdinaryStringSplitEffectsFromTaintedLocal,
    collectPreciseArrayLoadNodeIdsFromTaintedLocal,
} from "../ordinary/OrdinaryArrayPropagation";
import {
    collectObjectLiteralFieldCaptureFactsFromObjectField,
    collectObjectLiteralFieldCaptureFactsFromValue,
    collectOrdinaryClosureLocalReadbackFactsFromParentLocal,
    collectOrdinaryClosureLocalWritebackFactsFromTaintedLocal,
    collectOrdinaryTaintPreservingDestinationLocals,
    collectOrdinaryErrorMessageFactsFromTaintedLocal,
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
            log
        } = this.deps;
        const startedAt = Date.now();
        let truncated = false;
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
            log(`[WorklistBudget] truncated reason=${reason} head=${queueHead} total=${worklist.length} visited=${visited.size} elapsedMs=${elapsedMs}`);
            budget.onTruncated?.(event);
            return true;
        };
        const measureSection = <T>(section: string, fn: () => T): T =>
            profiler ? profiler.measure(section, fn) : fn();
        const transferExecutor = measureSection(
            "precompute_transfer_executor",
            () => new ConfigBasedTransferExecutor(transferRules || [], scene),
        );
        const unresolvedThisFieldLoadNodeIdsByFieldAndFile = measureSection("precompute_unresolved_this_field", () => buildUnresolvedThisFieldLoadNodeIdsByFieldAndFile(
            scene,
            pag,
            allowedMethodSignatures
        ));
        const classBySignature = measureSection("precompute_class_index", () => buildClassSignatureIndex(scene));
        const classRelationCache = new Map<string, boolean>();
        const preciseArrayLoadCache = new Map<string, number[]>();
        const fieldPropagationEngine = new FieldPropagationEngine({
            scene,
            pag,
            tracker,
            classBySignature,
            fieldAccessIndex: FieldAccessIndex.fromFieldToVarIndex(fieldToVarIndex),
            unresolvedThisFieldLoadNodeIdsByFieldAndFile,
            classRelationCache,
            preciseArrayLoadCache,
        });
        const ordinarySharedStateIndex = measureSection("precompute_shared_state_index", () => buildOrdinarySharedStateIndex(scene, pag));
        const objectNodeIdsByClassSignature = measureSection("precompute_object_node_class_index", () => {
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
        const factRuleChains = new Map<string, FactRuleChain>();
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
                    const topElem = ctxManager.getTopElement(baseFact.contextID);
                    if (topElem !== -1 && topElem !== decl.callSiteId) {
                        targetContextId = baseFact.contextID;
                    } else {
                        targetContextId = ctxManager.restoreCallerContext(baseFact.contextID);
                    }
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
            factRuleChains.set(seedFact.taintId, chain);
            onFactRuleChain?.(seedFact.taintId, chain);
            onFactObserved?.(seedFact);
        }
        let queueHead = 0;
        profiler?.onQueueSize(worklist.length - queueHead);
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
            const fact = worklist[queueHead++]!;
            traceSection("dequeue", fact);
            profiler?.onDequeue(worklist.length - queueHead);
            traceGraph?.recordFact(fact);
            const node = fact.node;
            const currentCtx = fact.contextID;
            const factKey = fact.taintId;
            const currentChain = factRuleChains.get(factKey) || initialChainForFact(fact);
            factRuleChains.set(factKey, currentChain);
            onFactRuleChain?.(factKey, currentChain);
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
                worklist.push(newFact);
                const newChain = cloneChain(chainOverride || currentChain);
                factRuleChains.set(newFactKey, newChain);
                onFactRuleChain?.(newFactKey, newChain);
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

            const stmt = (node as any).stmt;
            if (stmt?.containsInvokeExpr?.() && stmt.getInvokeExpr) {
                traceSection("module_invoke", fact);
                const invokeExpr = stmt.getInvokeExpr();
                const methodSig = invokeExpr?.getMethodSignature?.();
                const invokeEmissions = measureSection("module_invoke", () => moduleRuntime.emitForInvoke({
                    scene,
                    pag,
                    allowedMethodSignatures,
                    fieldToVarIndex,
                    queries: moduleQueries,
                    log,
                    fact,
                    node,
                    stmt,
                    invokeExpr,
                    callSignature: methodSig?.toString?.() || "",
                    methodName: methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "",
                    declaringClassName: methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "",
                    args: invokeExpr?.getArgs ? invokeExpr.getArgs() : [],
                    baseValue: invokeExpr?.getBase ? invokeExpr.getBase() : undefined,
                    resultValue: stmt instanceof ArkAssignStmt ? stmt.getLeftOp?.() : undefined,
                } as InternalRawModuleInvokeEvent));
                for (const emission of invokeEmissions) {
                    const newFact = emission.fact;
                    tryEnqueue(emission.reason, newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, newFact.source, newFact.field, newFact.taintId);
                        log(`    [${emission.reason}] Tainted node ${newFact.node.getID()} (ctx=${newFact.contextID})`);
                    }, emission.chain, emission.allowUnreachableTarget === true, emission.currentnessCertificates);
                }
            }

            if (fact.field && fact.field.length > 0) {
                const sourceFieldName = fact.field[0];
                const sourceKey = `${node.getID()}#${sourceFieldName}`;
                const bridgeInfos = syntheticFieldBridgeMap.get(sourceKey) || [];
                for (const bridge of bridgeInfos) {
                    const targetObjectNode = pag.getNode(bridge.targetObjectNodeId) as PagNode;
                    if (!targetObjectNode) continue;
                    const targetFieldPath = fact.field.length > 1
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
                            + `-> Obj ${bridge.targetObjectNodeId}.${bridge.targetFieldName} (ctx=${currentCtx})`
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

                const closureWritebackFacts = collectOrdinaryClosureLocalWritebackFactsFromTaintedLocal(
                    node,
                    fact.source,
                    currentCtx,
                    pag,
                    scene,
                );
                for (const newFact of closureWritebackFacts) {
                    tryEnqueue("Closure-Local-Writeback", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                        log(`    [Closure-Local-Writeback] Tainted captured local node ${newFact.node.getID()} (ctx=${newFact.contextID})`);
                    });
                }

                const closureReadbackFacts = collectOrdinaryClosureLocalReadbackFactsFromParentLocal(
                    node,
                    fact.source,
                    currentCtx,
                    pag,
                    scene,
                );
                for (const newFact of closureReadbackFacts) {
                    tryEnqueue("Closure-Local-Readback", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.taintId);
                        log(`    [Closure-Local-Readback] Tainted captured read local node ${newFact.node.getID()} (ctx=${newFact.contextID})`);
                    });
                }
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
                        const topElem = ctxManager.getTopElement(currentCtx);
                        if (topElem !== -1 && topElem !== captureEdge.callSiteId) {
                            continue;
                        }
                        newCtx = ctxManager.restoreCallerContext(currentCtx);
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
                for (const edge of syntheticEdges) {
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
                        const topElem = ctxManager.getTopElement(currentCtx);
                        if (topElem !== -1 && topElem !== edge.callSiteId) {
                            continue;
                        }
                        newCtx = ctxManager.restoreCallerContext(currentCtx);
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
                        const targetNode = pag.getNode(store.objId) as PagNode;
                        if (!targetNode) continue;
                        const newFact = new TaintFact(
                            targetNode,
                            fact.source,
                            currentCtx,
                            [toContainerFieldKey(store.slot)],
                        );
                        tryEnqueue("Array-Mutation-Slot", newFact, () => {
                            tracker.markTainted(targetNode.getID(), currentCtx, fact.source, newFact.field, newFact.taintId);
                            log(`    [Array-Mutation-Slot] Tainted Obj ${targetNode.getID()}.${store.slot} via ordinary array mutation (ctx=${currentCtx})`);
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
                for (const edge of copyEdges) {
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
                            const topElem = ctxManager.getTopElement(currentCtx);
                            if (topElem !== -1 && topElem !== callEdgeInfo.callSiteId) {
                                log(`    [Return-SKIP] ${callEdgeInfo.calleeMethodName} -> ${callEdgeInfo.callerMethodName}, ctx top=${topElem} != callsite=${callEdgeInfo.callSiteId}`);
                                continue;
                            }
                            newCtx = ctxManager.restoreCallerContext(currentCtx);
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
    }
}
