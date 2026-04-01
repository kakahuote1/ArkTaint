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
import { TaintContextManager, CallEdgeInfo, CallEdgeType } from "../context/TaintContext";
import { propagateExpressionTaint } from "./ExpressionPropagation";
import { CaptureEdgeInfo, ReceiverFieldBridgeInfo } from "../builders/CallEdgeMapBuilder";
import {
    SyntheticInvokeEdgeInfo,
    SyntheticConstructorStoreInfo,
    SyntheticFieldBridgeInfo,
    SyntheticStaticInitStoreInfo,
} from "../builders/SyntheticInvokeEdgeBuilder";
import { WorklistProfiler } from "../debug/WorklistProfiler";
import { PropagationTrace } from "../debug/PropagationTrace";
import { TransferRule } from "../../rules/RuleSchema";
import { ConfigBasedTransferExecutor, TransferExecutionResult } from "../rules/ConfigBasedTransferExecutor";
import type { SemanticPackQueryApi } from "../contracts/SemanticPack";
import { SemanticPackRuntime } from "../contracts/SemanticPack";
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
import {
    collectOrdinaryPromiseCallbackFactsFromTaintedArg,
    collectOrdinaryPromiseCallbackFactsFromTaintedReceiver,
    collectOrdinaryPromiseFinallyCaptureFactsFromTaintedLocal,
    shouldPropagateOrdinaryAsyncCallbacks,
} from "../ordinary/OrdinaryAsyncCompletion";
import {
    collectAliasLocalsForCarrier,
    collectCarrierNodeIdsForValueAtStmt,
} from "../ordinary/OrdinaryAliasPropagation";
import {
    collectOrdinaryArrayConstructorEffectsFromTaintedLocal,
    collectOrdinaryArrayFromMapperCallbackParamNodeIdsForObj,
    collectOrdinaryArrayFromMapperCallbackParamNodeIdsFromTaintedLocal,
    collectOrdinaryArrayHigherOrderEffectsFromTaintedLocal,
    collectOrdinaryArrayMutationEffectsFromTaintedLocal,
    collectOrdinaryArraySlotLoadNodeIds,
    collectOrdinaryArrayStaticViewEffectsBySlot,
    collectOrdinaryArrayViewEffectsBySlot,
    collectOrdinaryStringSplitEffectsFromTaintedLocal,
    collectPreciseArrayLoadNodeIdsFromTaintedLocal,
} from "../ordinary/OrdinaryArrayPropagation";
import {
    collectArrayStoreFactsFromTaintedLocal,
    collectOrdinaryCopyLikeResultFactsFromTaintedObj,
    collectOrdinaryRegexArrayResultFactsFromTaintedLocal,
    collectOrdinarySerializedStringResultFactsFromTaintedLocal,
    collectDirectFieldStoreFallbackFactsFromTaintedLocal,
    collectNestedArrayStoreFactsFromTaintedLocal,
    collectNestedFieldStoreFactsFromTaintedLocal,
    collectObjectLiteralFieldCaptureFactsFromTaintedObj,
    collectPreciseArrayLoadNodeIdsFromTaintedObjSlot,
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
    selectThisFieldFallbackLoads,
    type ThisFieldFallbackLoadNodeIds,
} from "./WorklistReachabilitySupport";
import {
    findStoreAnchorStmtForTaintedValue,
    propagateArrayElementLoads,
    propagateCapturedFieldWrites,
    propagateDirectFieldArgUsesByObj,
    propagateDirectFieldLoadsByLocal,
    propagateDirectFieldLoadsByObj,
    propagateObjectAssignFieldBridgesByObj,
    propagateObjectResultContainerStoresByObj,
    propagateObjectResultLoadsByObj,
    propagateReflectGetFieldLoadsByObj,
    propagateReflectSetFieldStores,
    propagateRestArrayParam,
} from "./WorklistFieldPropagation";

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
    propagationTrace?: PropagationTrace;
    allowedMethodSignatures?: Set<string>;
    semanticPackRuntime: SemanticPackRuntime;
    semanticPackQueries: SemanticPackQueryApi;
    onFactObserved?: (fact: TaintFact) => void;
    onCallEdge?: (event: CallEdgeEvent) => PropagationContributionBatch;
    onTaintFlow?: (event: TaintFlowEvent) => PropagationContributionBatch;
    onMethodReached?: (event: MethodReachedEvent) => PropagationContributionBatch;
    log: (msg: string) => void;
}

export interface FactRuleChain {
    sourceRuleId?: string;
    transferRuleIds: string[];
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
            propagationTrace,
            allowedMethodSignatures,
            semanticPackRuntime,
            semanticPackQueries,
            onFactObserved,
            onCallEdge,
            onTaintFlow,
            onMethodReached,
            log
        } = this.deps;
        const transferExecutor = new ConfigBasedTransferExecutor(transferRules || [], scene);
        const unresolvedThisFieldLoadNodeIdsByFieldAndFile = buildUnresolvedThisFieldLoadNodeIdsByFieldAndFile(
            scene,
            pag,
            allowedMethodSignatures
        );
        const classBySignature = buildClassSignatureIndex(scene);
        const classRelationCache = new Map<string, boolean>();
        const preciseArrayLoadCache = new Map<string, number[]>();
        const ordinarySharedStateIndex = buildOrdinarySharedStateIndex(scene, pag);
        const objectNodeIdsByClassSignature = new Map<string, Set<number>>();
        for (const rawNode of pag.getNodesIter()) {
            const pagNode = rawNode as PagNode;
            const classSig = resolveObjectClassSignatureByNode(pagNode);
            if (!classSig) continue;
            if (!objectNodeIdsByClassSignature.has(classSig)) {
                objectNodeIdsByClassSignature.set(classSig, new Set<number>());
            }
            objectNodeIdsByClassSignature.get(classSig)!.add(pagNode.getID());
        }
        if (unresolvedThisFieldLoadNodeIdsByFieldAndFile.size > 0) {
            let unresolvedLoadCount = 0;
            for (const fileMap of unresolvedThisFieldLoadNodeIdsByFieldAndFile.values()) {
                for (const classMap of fileMap.values()) {
                    for (const ids of classMap.values()) {
                        unresolvedLoadCount += ids.size;
                    }
                }
            }
            log(`[Field-LoadFallback] this-field fallback fields=${unresolvedThisFieldLoadNodeIdsByFieldAndFile.size}, loads=${unresolvedLoadCount}`);
        }
        const factRuleChains = new Map<string, FactRuleChain>();
        const cloneChain = (chain?: FactRuleChain): FactRuleChain => ({
            sourceRuleId: chain?.sourceRuleId,
            transferRuleIds: [...(chain?.transferRuleIds || [])],
        });
        const parseSourceRuleId = (source: string): string | undefined => {
            if (!source.startsWith("source_rule:")) return undefined;
            const id = source.slice("source_rule:".length).trim();
            return id.length > 0 ? id : undefined;
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
                        return undefined;
                    }
                    targetContextId = ctxManager.restoreCallerContext(baseFact.contextID);
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
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, newFact.source, newFact.field, newFact.id);
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
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, newFact.source, newFact.field, newFact.id);
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
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, newFact.source, newFact.field, newFact.id);
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
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, newFact.source, newFact.field, newFact.id);
                        log(`    [Plugin-Fact] Tainted node ${newFact.node.getID()} (ctx=${newFact.contextID})`);
                    },
                    mergeRuleChain(baseChain, decl.chain),
                    decl.allowUnreachableTarget === true,
                );
            }
        };
        for (const seedFact of worklist) {
            const chain = initialChainForFact(seedFact);
            factRuleChains.set(seedFact.id, chain);
            onFactRuleChain?.(seedFact.id, chain);
            onFactObserved?.(seedFact);
        }
        let queueHead = 0;
        profiler?.onQueueSize(worklist.length - queueHead);
        const reachedMethodSignatures = new Set<string>();

        while (queueHead < worklist.length) {
            const fact = worklist[queueHead++]!;
            profiler?.onDequeue(worklist.length - queueHead);
            propagationTrace?.recordFact(fact);
            const node = fact.node;
            const currentCtx = fact.contextID;
            const currentChain = factRuleChains.get(fact.id) || initialChainForFact(fact);
            factRuleChains.set(fact.id, currentChain);
            onFactRuleChain?.(fact.id, currentChain);
                if (!isNodeAllowedByReachability(node, allowedMethodSignatures)) {
                continue;
            }
            const tryEnqueue = (
                reason: string,
                newFact: TaintFact,
                onAccepted: () => void,
                chainOverride?: FactRuleChain,
                allowUnreachableTarget: boolean = false,
            ): void => {
                if (
                    !allowUnreachableTarget
                    && !isNodeAllowedByReachability(newFact.node, allowedMethodSignatures)
                ) {
                    return;
                }
                profiler?.onEnqueueAttempt(reason);
                if (visited.has(newFact.id)) {
                    profiler?.onDedupDrop(reason);
                    return;
                }
                visited.add(newFact.id);
                worklist.push(newFact);
                const newChain = cloneChain(chainOverride || currentChain);
                factRuleChains.set(newFact.id, newChain);
                onFactRuleChain?.(newFact.id, newChain);
                onFactObserved?.(newFact);
                profiler?.onEnqueueSuccess(reason, worklist.length - queueHead);
                propagationTrace?.recordEdge(fact, newFact, reason);
                const taintFlowBatch = onTaintFlow?.({
                    reason,
                    fromFact: fact,
                    toFact: newFact,
                }) || createEmptyPropagationContributionBatch();
                applyPluginPropagationBatch(taintFlowBatch, newFact, newChain, tryEnqueue);
                onAccepted();
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

            const semanticPackEmissions = semanticPackRuntime.emitForFact({
                scene,
                pag,
                allowedMethodSignatures,
                fieldToVarIndex,
                queries: semanticPackQueries,
                log,
                fact,
                node,
            });
            for (const emission of semanticPackEmissions) {
                const newFact = emission.fact;
                tryEnqueue(emission.reason, newFact, () => {
                    tracker.markTainted(newFact.node.getID(), newFact.contextID, newFact.source, newFact.field, newFact.id);
                    log(`    [${emission.reason}] Tainted node ${newFact.node.getID()} (ctx=${newFact.contextID})`);
                }, emission.chain, emission.allowUnreachableTarget === true);
            }

            const stmt = (node as any).stmt;
            if (stmt?.containsInvokeExpr?.() && stmt.getInvokeExpr) {
                const invokeExpr = stmt.getInvokeExpr();
                const methodSig = invokeExpr?.getMethodSignature?.();
                const invokeEmissions = semanticPackRuntime.emitForInvoke({
                    scene,
                    pag,
                    allowedMethodSignatures,
                    fieldToVarIndex,
                    queries: semanticPackQueries,
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
                });
                for (const emission of invokeEmissions) {
                    const newFact = emission.fact;
                    tryEnqueue(emission.reason, newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, newFact.source, newFact.field, newFact.id);
                        log(`    [${emission.reason}] Tainted node ${newFact.node.getID()} (ctx=${newFact.contextID})`);
                    }, emission.chain, emission.allowUnreachableTarget === true);
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
            }

            const exprTargetNodes = propagateExpressionTaint(
                node.getID(),
                node.getValue(),
                currentCtx,
                tracker,
                pag,
                fact.field,
            );
            for (const targetNodeId of exprTargetNodes) {
                const targetNode = pag.getNode(targetNodeId) as PagNode;
                const newFact = new TaintFact(targetNode, fact.source, currentCtx, fact.field);
                tryEnqueue("Expr", newFact, () => {
                    tracker.markTainted(targetNodeId, currentCtx, fact.source, newFact.field, newFact.id);
                    log(`    [Expr] Tainted node ${targetNodeId} (ctx=${currentCtx})`);
                });
            }

            if (fact.field && fact.field.length > 0) {
                const serializedStringFacts = collectOrdinarySerializedStringResultFactsFromTaintedLocal(
                    node,
                    fact.source,
                    currentCtx,
                    pag,
                );
                for (const newFact of serializedStringFacts) {
                    tryEnqueue("CopyLike-Stringify", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [CopyLike-Stringify] Tainted serialized result node ${newFact.node.getID()} (ctx=${currentCtx})`);
                    });
                }
            }

            const transferExec = transferExecutor.executeFromTaintedFactWithStats(
                fact,
                pag,
                tracker
            );
            profiler?.onTransferStats(transferExec.stats);
            const transferResults = transferExec.results;
            for (const transferResult of transferResults) {
                const newFact = transferResult.fact;
                const chainWithTransfer: FactRuleChain = {
                    sourceRuleId: currentChain.sourceRuleId,
                    transferRuleIds: [...currentChain.transferRuleIds, transferResult.ruleId],
                };
                tryEnqueue("Rule-Transfer", newFact, () => {
                    tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
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
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Capture-Store] Tainted field '${newFact.field?.[0]}' of Obj ${newFact.node.getID()} (ctx=${currentCtx})`);
                    });
                }
            }

            if (!fact.field || fact.field.length === 0) {
            const reflectSetFacts = propagateReflectSetFieldStores(pag, node, fact.source, currentCtx);
                for (const newFact of reflectSetFacts) {
                    tryEnqueue("Reflect-Store", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Reflect-Store] Tainted field '${newFact.field?.[0]}' of Obj ${newFact.node.getID()} (ctx=${currentCtx})`);
                    });
                }
            }

            const captureEdges = ensureCaptureEdgesForNode
                ? (ensureCaptureEdgesForNode(node.getID()) || captureEdgeMap.get(node.getID()))
                : captureEdgeMap.get(node.getID());
            if (captureEdges && (!fact.field || fact.field.length === 0)) {
                for (const captureEdge of captureEdges) {
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
                    const newFact = new TaintFact(targetNode, fact.source, newCtx);
                    tryEnqueue(captureEdge.direction === "backward" ? "Capture-Backward" : "Capture", newFact, () => {
                        tracker.markTainted(captureEdge.dstNodeId, newCtx, fact.source, newFact.field, newFact.id);
                        log(
                            `    [Capture-${captureEdge.direction === "backward" ? "Bwd" : "Fwd"}] `
                            + `${captureEdge.callerMethodName} -> ${captureEdge.calleeMethodName}, `
                            + `node ${node.getID()} -> ${captureEdge.dstNodeId}, ctx: ${currentCtx} -> ${newCtx}`
                        );
                    });
                }
            }

            const syntheticEdges = ensureSyntheticInvokeEdgesForNode
                ? (ensureSyntheticInvokeEdgesForNode(node.getID()) || syntheticInvokeEdgeMap.get(node.getID()))
                : syntheticInvokeEdgeMap.get(node.getID());
            if (syntheticEdges && (!fact.field || fact.field.length === 0)) {
                for (const edge of syntheticEdges) {
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
                    const newFact = new TaintFact(targetNode, fact.source, newCtx);
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
                    tryEnqueue(reason, newFact, () => {
                        tracker.markTainted(edge.dstNodeId, newCtx, fact.source, newFact.field, newFact.id);
                        log(`    [Synthetic-${edge.type === CallEdgeType.CALL ? "Call" : "Return"}] ${edge.callerMethodName} -> ${edge.calleeMethodName}, ${edge.srcNodeId} -> ${edge.dstNodeId}, ctx: ${currentCtx} -> ${newCtx}`);
                    });
                }
            }

            const ctorStores = syntheticConstructorStoreMap.get(node.getID());
            if (ctorStores && (!fact.field || fact.field.length === 0)) {
                for (const info of ctorStores) {
                    const objNode = pag.getNode(info.objId) as PagNode;
                    const newFact = new TaintFact(objNode, fact.source, currentCtx, [info.fieldName]);
                    tryEnqueue("Synthetic-CtorStore", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Synthetic-CtorStore] arg ${info.srcNodeId} -> Obj ${info.objId}.${info.fieldName} (ctx=${currentCtx})`);
                    });
                }
            }

            const shouldPropagatePromiseCallbacks = shouldPropagateOrdinaryAsyncCallbacks(fact.field);
            if (shouldPropagatePromiseCallbacks) {
                const val = node.getValue();
                const promiseCallbackFacts = val instanceof Local
                    ? collectOrdinaryPromiseCallbackFactsFromTaintedReceiver(
                        scene,
                        pag,
                        val,
                        fact.source,
                        currentCtx,
                        fact.field,
                    )
                    : [];
                for (const newFact of promiseCallbackFacts) {
                    tryEnqueue("Promise-CB", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Promise-CB] Tainted callback param node ${newFact.node.getID()} (ctx=${newFact.contextID})`);
                    });
                }
            }

            if (shouldPropagatePromiseCallbacks) {
                const val = node.getValue();
                const promiseArgFacts = val instanceof Local
                    ? collectOrdinaryPromiseCallbackFactsFromTaintedArg(
                        scene,
                        pag,
                        val,
                        fact.source,
                        currentCtx,
                        fact.field,
                    )
                    : [];
                for (const newFact of promiseArgFacts) {
                    tryEnqueue("Promise-Arg", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Promise-Arg] Tainted callback param node ${newFact.node.getID()} (ctx=${newFact.contextID})`);
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
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
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
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Synthetic-StaticInitStore] local ${info.srcNodeId} -> static field ${info.staticFieldNodeId} (ctx=${sharedStateCtx})`);
                    });
                }
            }

            if (shouldPropagatePromiseCallbacks) {
                const val = node.getValue();
                const promiseFinallyCaptureFacts = val instanceof Local
                    ? collectOrdinaryPromiseFinallyCaptureFactsFromTaintedLocal(
                        scene,
                        pag,
                        val,
                        fact.source,
                        currentCtx,
                        fact.field,
                    )
                    : [];
                for (const newFact of promiseFinallyCaptureFacts) {
                    tryEnqueue("Promise-Finally-Capture", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Promise-Finally-Capture] Tainted finally capture node ${newFact.node.getID()} (ctx=${newFact.contextID})`);
                    });
                }
            }

            if (!fact.field || fact.field.length === 0) {
            const restArgFacts = propagateRestArrayParam(scene, pag, ctxManager, node, fact.source, currentCtx);
                for (const newFact of restArgFacts) {
                    tryEnqueue("Rest-Arg", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Rest-Arg] Tainted rest param node ${newFact.node.getID()} (ctx=${newFact.contextID})`);
                    });
                }
            }

            if (!fact.field || fact.field.length === 0) {
            const arrayLoadFacts = propagateArrayElementLoads(pag, node, fact.source, currentCtx);
                for (const newFact of arrayLoadFacts) {
                    tryEnqueue("Array-Load", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
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
                            tracker.markTainted(targetNodeId, currentCtx, fact.source, newFact.field, newFact.id);
                            log(`    [Array-Precise] Tainted node ${targetNodeId} from ordinary array slot load (ctx=${currentCtx})`);
                        });
                    }

                    const ordinaryArrayMutation = collectOrdinaryArrayMutationEffectsFromTaintedLocal(value, pag);
                    for (const targetNodeId of ordinaryArrayMutation.baseNodeIds) {
                        const targetNode = pag.getNode(targetNodeId) as PagNode;
                        if (!targetNode) continue;
                        const newFact = new TaintFact(targetNode, fact.source, currentCtx);
                        tryEnqueue("Array-Mutation-Base", newFact, () => {
                            tracker.markTainted(targetNodeId, currentCtx, fact.source, newFact.field, newFact.id);
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
                            tracker.markTainted(targetNode.getID(), currentCtx, fact.source, newFact.field, newFact.id);
                            log(`    [Array-Mutation-Slot] Tainted Obj ${targetNode.getID()}.${store.slot} via ordinary array mutation (ctx=${currentCtx})`);
                        });
                    }

                    const ordinaryArrayHigherOrder = collectOrdinaryArrayHigherOrderEffectsFromTaintedLocal(value, pag, scene);
                    for (const targetNodeId of ordinaryArrayHigherOrder.callbackParamNodeIds) {
                        const targetNode = pag.getNode(targetNodeId) as PagNode;
                        if (!targetNode) continue;
                        const newFact = new TaintFact(targetNode, fact.source, currentCtx);
                        tryEnqueue("Array-HOF-CB", newFact, () => {
                            tracker.markTainted(targetNodeId, currentCtx, fact.source, newFact.field, newFact.id);
                            log(`    [Array-HOF-CB] Tainted callback param node ${targetNodeId} from ordinary array higher-order flow (ctx=${currentCtx})`);
                        });
                    }
                    for (const targetNodeId of ordinaryArrayHigherOrder.resultNodeIds) {
                        const targetNode = pag.getNode(targetNodeId) as PagNode;
                        if (!targetNode) continue;
                        const newFact = new TaintFact(targetNode, fact.source, currentCtx);
                        tryEnqueue("Array-HOF-Result", newFact, () => {
                            tracker.markTainted(targetNodeId, currentCtx, fact.source, newFact.field, newFact.id);
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
                            tracker.markTainted(targetNode.getID(), currentCtx, fact.source, newFact.field, newFact.id);
                            log(`    [Array-HOF-ResultStore] Tainted Obj ${targetNode.getID()}.${store.slot} from ordinary array higher-order flow (ctx=${currentCtx})`);
                        });
                    }

                    const ordinaryArrayCtor = collectOrdinaryArrayConstructorEffectsFromTaintedLocal(value, pag);
                    for (const targetNodeId of ordinaryArrayCtor.resultNodeIds) {
                        const targetNode = pag.getNode(targetNodeId) as PagNode;
                        if (!targetNode) continue;
                        const newFact = new TaintFact(targetNode, fact.source, currentCtx);
                        tryEnqueue("Array-Constructor", newFact, () => {
                            tracker.markTainted(targetNodeId, currentCtx, fact.source, newFact.field, newFact.id);
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
                            tracker.markTainted(targetNode.getID(), currentCtx, fact.source, newFact.field, newFact.id);
                            log(`    [Array-Constructor-Store] Tainted Obj ${targetNode.getID()}.${store.slot} from ordinary array constructor/view flow (ctx=${currentCtx})`);
                        });
                    }

                    const ordinaryStringSplit = collectOrdinaryStringSplitEffectsFromTaintedLocal(value, pag);
                    for (const targetNodeId of ordinaryStringSplit.resultNodeIds) {
                        const targetNode = pag.getNode(targetNodeId) as PagNode;
                        if (!targetNode) continue;
                        const newFact = new TaintFact(targetNode, fact.source, currentCtx);
                        tryEnqueue("String-Split", newFact, () => {
                            tracker.markTainted(targetNodeId, currentCtx, fact.source, newFact.field, newFact.id);
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
                            tracker.markTainted(targetNode.getID(), currentCtx, fact.source, newFact.field, newFact.id);
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
                            tracker.markTainted(targetNodeId, currentCtx, fact.source, newFact.field, newFact.id);
                            log(`    [Array-From-Mapper-CB] Tainted callback param node ${targetNodeId} from ordinary Array.from mapper (ctx=${currentCtx})`);
                        });
                    }
                }
            }

            const copyEdges = node.getOutgoingCopyEdges();
            if (copyEdges) {
                for (const edge of copyEdges) {
                    if (semanticPackRuntime.shouldSkipCopyEdge({
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
                    if (fact.field && fact.field.length > 0 && !callEdgeInfo) {
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
                        tracker.markTainted(targetNodeId, newCtx, fact.source, newFact.field, newFact.id);
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
                        if (fieldNode instanceof PagStaticFieldNode) {
                            const newFact = new TaintFact(fieldNode as PagNode, fact.source, sharedStateCtx);
                            tryEnqueue("Store-StaticField", newFact, () => {
                                tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                                log(`    [Store-StaticField] Tainted static field node ${newFact.node.getID()} (ctx=${sharedStateCtx})`);
                            });
                            continue;
                        }

                        if (fieldNode instanceof PagArrayNode) {
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
                                    tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                                    log(`    [Store-ArraySlot] Tainted slot '${slotKey}' of Obj ${carrierNodeId} (ctx=${currentCtx})`);
                                });
                            }
                            continue;
                        }

                        if (!(fieldNode instanceof PagInstanceFieldNode)) continue;

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
                                tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                                log(`    [Store] Tainted field '${fieldName}' of Obj ${carrierNodeId} (ctx=${currentCtx})`);
                            });
                        }
                    }
                }

                const localStoreFallbackFacts = collectDirectFieldStoreFallbackFactsFromTaintedLocal(
                    node,
                    fact.source,
                    currentCtx,
                    pag,
                    classBySignature,
                );
                for (const newFact of localStoreFallbackFacts) {
                    tryEnqueue("Store-FieldFallback", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        const fieldName = newFact.field?.[0] || "<field>";
                        log(`    [Store-FieldFallback] Tainted Obj ${newFact.node.getID()}.${fieldName} (ctx=${newFact.contextID})`);
                    });
                }

                const arrayStoreFallbackFacts = collectArrayStoreFactsFromTaintedLocal(
                    node,
                    fact.source,
                    currentCtx,
                    pag,
                    classBySignature,
                );
                for (const newFact of arrayStoreFallbackFacts) {
                    tryEnqueue("Store-ArrayFallback", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        const fieldName = newFact.field?.[0] || "<slot>";
                        log(`    [Store-ArrayFallback] Tainted Obj ${newFact.node.getID()}.${fieldName} (ctx=${newFact.contextID})`);
                    });
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
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
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
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
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
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
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
                            tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                            log(
                                `    [Receiver-Field-WriteBack] ${bridgeInfo.calleeMethodName} -> ${bridgeInfo.callerMethodName}, `
                                + `node ${bridgeInfo.targetCarrierNodeId}.${fact.field?.join(".")} (ctx=${currentCtx} -> ${restoredCtx})`
                            );
                        });
                    }
                }

                const localFieldFacts = propagateDirectFieldLoadsByLocal(pag, node, fact.field, fact.source, currentCtx);
                for (const newFact of localFieldFacts) {
                    tryEnqueue("Load-LocalField", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Load-LocalField] Tainted node ${newFact.node.getID()} from local field '${fact.field?.[0]}' (ctx=${currentCtx})`);
                    });
                }
            }

            if (fact.field && fact.field.length > 0) {
                const reflectFacts = propagateReflectGetFieldLoadsByObj(pag, node.getID(), fact.field, fact.source, currentCtx, classBySignature);
                for (const newFact of reflectFacts) {
                    tryEnqueue("Reflect-Load", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Reflect-Load] Tainted var ${newFact.node.getID()} from Reflect.get field '${fact.field[0]}' (ctx=${currentCtx})`);
                    });
                }
            }

            if (fact.field && fact.field.length > 0) {
                const directFieldFacts = propagateDirectFieldLoadsByObj(pag, node.getID(), fact.field, fact.source, currentCtx, classBySignature);
                for (const newFact of directFieldFacts) {
                    tryEnqueue("Load-DirectField", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Load-DirectField] Tainted var ${newFact.node.getID()} from direct field '${fact.field?.[0]}' (ctx=${currentCtx})`);
                    });
                }
            }

            if (fact.field && fact.field.length > 0) {
                const directFieldArgFacts = propagateDirectFieldArgUsesByObj(pag, node.getID(), fact.field, fact.source, currentCtx, classBySignature);
                for (const newFact of directFieldArgFacts) {
                    tryEnqueue("Load-DirectField-Arg", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Load-DirectField-Arg] Tainted node ${newFact.node.getID()} from direct field arg '${fact.field?.[0]}' (ctx=${currentCtx})`);
                    });
                }
            }

            if (fact.field && fact.field.length > 0) {
                const objectLiteralFieldCaptureFacts = collectObjectLiteralFieldCaptureFactsFromTaintedObj(
                    node.getID(),
                    fact.field,
                    fact.source,
                    currentCtx,
                    pag,
                    classBySignature,
                );
                for (const newFact of objectLiteralFieldCaptureFacts) {
                    tryEnqueue("Store-ObjectLiteralFieldCapture", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Store-ObjectLiteralFieldCapture] Tainted Obj ${newFact.node.getID()}.${newFact.field?.join(".")} via ordinary object literal shorthand (ctx=${newFact.contextID})`);
                    });
                }
            }

            if (fact.field && fact.field.length > 0) {
                const nestedFieldStoreFacts = collectNestedFieldStoreFactsFromTaintedLocal(
                    node,
                    fact.field,
                    fact.source,
                    currentCtx,
                    pag,
                    classBySignature,
                );
                for (const newFact of nestedFieldStoreFacts) {
                    tryEnqueue("Store-NestedFieldFallback", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Store-NestedFieldFallback] Tainted Obj ${newFact.node.getID()}.${newFact.field?.join(".")} (ctx=${newFact.contextID})`);
                    });
                }
            }

            if (fact.field && fact.field.length > 0) {
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
                            tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                            log(`    [Store-StaticField] Tainted static field node ${newFact.node.getID()}.${newFact.field?.join(".")} (ctx=${sharedStateCtx})`);
                        });
                    }
                }

                const nestedArrayStoreFacts = collectNestedArrayStoreFactsFromTaintedLocal(
                    node,
                    fact.field,
                    fact.source,
                    currentCtx,
                    pag,
                    classBySignature,
                );
                for (const newFact of nestedArrayStoreFacts) {
                    tryEnqueue("Store-NestedArrayFallback", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Store-NestedArrayFallback] Tainted Obj ${newFact.node.getID()}.${newFact.field?.join(".")} (ctx=${newFact.contextID})`);
                    });
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
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
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
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
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
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Load-StaticSharedState] Tainted node ${newFact.node.getID()}.${newFact.field?.join(".")} via shared static/module state (ctx=${newFact.contextID})`);
                    });
                }
            }

            if (fact.field && fact.field.length > 0) {
                const copyLikeResultFacts = collectOrdinaryCopyLikeResultFactsFromTaintedObj(
                    node.getID(),
                    fact.field,
                    fact.source,
                    currentCtx,
                    pag,
                    classBySignature,
                );
                for (const newFact of copyLikeResultFacts) {
                    tryEnqueue("CopyLike-Result", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [CopyLike-Result] Tainted node ${newFact.node.getID()} via ordinary copy/serialization boundary (ctx=${currentCtx})`);
                    });
                }
            }

            if (fact.field && fact.field.length > 0) {
                const objectResultFacts = propagateObjectResultLoadsByObj(pag, node.getID(), fact.source, currentCtx, classBySignature);
                for (const newFact of objectResultFacts) {
                    tryEnqueue("Object-Result", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Object-Result] Tainted result node ${newFact.node.getID()} from Object.values/entries on field '${fact.field?.[0]}' (ctx=${currentCtx})`);
                    });
                }
            }

            if (fact.field && fact.field.length > 0) {
                const objectResultStoreFacts = propagateObjectResultContainerStoresByObj(pag, node.getID(), fact.source, currentCtx, classBySignature);
                for (const newFact of objectResultStoreFacts) {
                    tryEnqueue("Object-Result-Store", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Object-Result-Store] Tainted slot '${fromContainerFieldKey(newFact.field?.[0] || "") || newFact.field?.[0]}' of Obj ${newFact.node.getID()} via Object.values/entries (ctx=${currentCtx})`);
                    });
                }
            }

            if (fact.field && fact.field.length > 0) {
                const objectAssignFacts = propagateObjectAssignFieldBridgesByObj(pag, node.getID(), fact.field, fact.source, currentCtx, classBySignature);
                for (const newFact of objectAssignFacts) {
                    tryEnqueue("Object-Assign", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Object-Assign] Tainted field '${newFact.field?.[0]}' of Obj ${newFact.node.getID()} via Object.assign (ctx=${currentCtx})`);
                    });
                }
            }

            if (fact.field && fact.field.length > 0) {
                const objId = fact.node.getID();
                const fieldName = fact.field[0];

                const containerSlot = fromContainerFieldKey(fieldName);
                if (containerSlot !== null && containerSlot.startsWith("arr:")) {
                    const remainingFieldPath = fact.field.length > 1 ? fact.field.slice(1) : undefined;

                    for (const targetNodeId of collectOrdinaryArraySlotLoadNodeIds(objId, containerSlot, pag, scene)) {
                        const targetNode = pag.getNode(targetNodeId) as PagNode;
                        if (!targetNode) continue;
                        const newFact = new TaintFact(targetNode, fact.source, currentCtx, remainingFieldPath ? [...remainingFieldPath] : undefined);
                        tryEnqueue("Array-LoadLike", newFact, () => {
                            tracker.markTainted(targetNodeId, currentCtx, fact.source, newFact.field, newFact.id);
                            log(`    [Array-LoadLike] Tainted node ${targetNodeId} from ordinary array slot '${containerSlot}' (ctx=${currentCtx})`);
                        });
                    }

                    const ordinaryArrayViewEffects = collectOrdinaryArrayViewEffectsBySlot(objId, containerSlot, pag);
                    for (const targetNodeId of ordinaryArrayViewEffects.resultNodeIds) {
                        const targetNode = pag.getNode(targetNodeId) as PagNode;
                        if (!targetNode) continue;
                        const newFact = new TaintFact(targetNode, fact.source, currentCtx, remainingFieldPath ? [...remainingFieldPath] : undefined);
                        tryEnqueue("Array-View", newFact, () => {
                            tracker.markTainted(targetNodeId, currentCtx, fact.source, newFact.field, newFact.id);
                            log(`    [Array-View] Tainted result node ${targetNodeId} from ordinary array view on slot '${containerSlot}' (ctx=${currentCtx})`);
                        });
                    }
                    for (const store of ordinaryArrayViewEffects.resultSlotStores) {
                        const targetNode = pag.getNode(store.objId) as PagNode;
                        if (!targetNode) continue;
                        const newFact = new TaintFact(
                            targetNode,
                            fact.source,
                            currentCtx,
                            [
                                toContainerFieldKey(store.slot),
                                ...(remainingFieldPath || []),
                            ],
                        );
                        tryEnqueue("Array-View-Store", newFact, () => {
                            tracker.markTainted(targetNode.getID(), currentCtx, fact.source, newFact.field, newFact.id);
                            log(`    [Array-View-Store] Tainted Obj ${targetNode.getID()}.${store.slot} from ordinary array view on slot '${containerSlot}' (ctx=${currentCtx})`);
                        });
                    }

                    const ordinaryArrayStaticViewEffects = collectOrdinaryArrayStaticViewEffectsBySlot(objId, containerSlot, pag);
                    for (const targetNodeId of ordinaryArrayStaticViewEffects.resultNodeIds) {
                        const targetNode = pag.getNode(targetNodeId) as PagNode;
                        if (!targetNode) continue;
                        const newFact = new TaintFact(targetNode, fact.source, currentCtx, remainingFieldPath ? [...remainingFieldPath] : undefined);
                        tryEnqueue("Array-StaticView", newFact, () => {
                            tracker.markTainted(targetNodeId, currentCtx, fact.source, newFact.field, newFact.id);
                            log(`    [Array-StaticView] Tainted result node ${targetNodeId} from ordinary array static view on slot '${containerSlot}' (ctx=${currentCtx})`);
                        });
                    }
                    for (const store of ordinaryArrayStaticViewEffects.resultSlotStores) {
                        const targetNode = pag.getNode(store.objId) as PagNode;
                        if (!targetNode) continue;
                        const newFact = new TaintFact(
                            targetNode,
                            fact.source,
                            currentCtx,
                            [
                                toContainerFieldKey(store.slot),
                                ...(remainingFieldPath || []),
                            ],
                        );
                        tryEnqueue("Array-StaticView-Store", newFact, () => {
                            tracker.markTainted(targetNode.getID(), currentCtx, fact.source, newFact.field, newFact.id);
                            log(`    [Array-StaticView-Store] Tainted Obj ${targetNode.getID()}.${store.slot} from ordinary array static view on slot '${containerSlot}' (ctx=${currentCtx})`);
                        });
                    }

                    for (const targetNodeId of collectOrdinaryArrayFromMapperCallbackParamNodeIdsForObj(objId, pag, scene)) {
                        const targetNode = pag.getNode(targetNodeId) as PagNode;
                        if (!targetNode) continue;
                        const newFact = new TaintFact(targetNode, fact.source, currentCtx, remainingFieldPath ? [...remainingFieldPath] : undefined);
                        tryEnqueue("Array-From-Mapper-CB", newFact, () => {
                            tracker.markTainted(targetNodeId, currentCtx, fact.source, newFact.field, newFact.id);
                            log(`    [Array-From-Mapper-CB] Tainted callback param node ${targetNodeId} from ordinary Array.from mapper on slot '${containerSlot}' (ctx=${currentCtx})`);
                        });
                    }
                }

                if (containerSlot === null) {
                    const sourceClassSig = resolveObjectClassSignatureByNode(node);
                    const peerObjIds = sourceClassSig ? objectNodeIdsByClassSignature.get(sourceClassSig) : undefined;
                    if (peerObjIds && peerObjIds.size > 0) {
                        for (const peerObjId of peerObjIds) {
                            if (peerObjId === objId) continue;
                            const peerNode = pag.getNode(peerObjId) as PagNode;
                            if (!peerNode) continue;
                            const peerFact = new TaintFact(peerNode, fact.source, currentCtx, [...fact.field]);
                            tryEnqueue("Class-Field-Broadcast", peerFact, () => {
                                tracker.markTainted(peerObjId, currentCtx, fact.source, peerFact.field, peerFact.id);
                                log(`    [Class-Field-Broadcast] Tainted Obj ${peerObjId}.${fieldName} from Obj ${objId}.${fieldName} (ctx=${currentCtx})`);
                            });
                        }
                    }
                }

                const key = `${objId}-${fieldName}`;
                let destVarIds: Iterable<number> | undefined = fieldToVarIndex.get(key);
                if (containerSlot !== null) {
                    const preciseCacheKey = `${objId}|${containerSlot}`;
                    let preciseDestVarIds = preciseArrayLoadCache.get(preciseCacheKey);
                    if (!preciseDestVarIds) {
                        preciseDestVarIds = collectPreciseArrayLoadNodeIdsFromTaintedObjSlot(objId, containerSlot, pag);
                        preciseArrayLoadCache.set(preciseCacheKey, preciseDestVarIds);
                    }
                    if (/^arr:-?\d+$/.test(containerSlot)) {
                        destVarIds = preciseDestVarIds;
                    } else if (preciseDestVarIds.length > 0) {
                        destVarIds = preciseDestVarIds;
                    }
                }
                if (destVarIds) {
                    for (const destVarId of destVarIds) {
                        const dstNode = pag.getNode(destVarId) as PagNode;
                        if (!dstNode) continue;
                        if (fact.field.length > 1) {
                            let hasPointTo = false;
                            for (const nestedObjId of dstNode.getPointTo()) {
                                hasPointTo = true;
                                const nestedObjNode = pag.getNode(nestedObjId) as PagNode;
                                if (!nestedObjNode) continue;
                                const newFact = new TaintFact(
                                    nestedObjNode,
                                    fact.source,
                                    currentCtx,
                                    fact.field.slice(1),
                                );
                                tryEnqueue("Load", newFact, () => {
                                    tracker.markTainted(
                                        nestedObjNode.getID(),
                                        currentCtx,
                                        fact.source,
                                        newFact.field,
                                        newFact.id,
                                    );
                                    log(`    [Load] Tainted Obj ${nestedObjId}.${newFact.field?.join(".")} from Obj ${objId}.${fieldName} (ctx=${currentCtx})`);
                                });
                            }
                            if (!hasPointTo) {
                                const newFact = new TaintFact(dstNode, fact.source, currentCtx, fact.field.slice(1));
                                tryEnqueue("Load", newFact, () => {
                                    tracker.markTainted(destVarId, currentCtx, fact.source, newFact.field, newFact.id);
                                    log(`    [Load] Tainted local ${destVarId}.${newFact.field?.join(".")} from Obj ${objId}.${fieldName} (ctx=${currentCtx})`);
                                });
                            }
                        } else {
                            const newFact = new TaintFact(dstNode, fact.source, currentCtx);
                            tryEnqueue("Load", newFact, () => {
                                tracker.markTainted(destVarId, currentCtx, fact.source, newFact.field, newFact.id);
                                log(`    [Load] Tainted var ${destVarId} from Obj ${objId}.${fieldName} (ctx=${currentCtx})`);
                            });
                        }
                    }
                }

                const sourceMethodSig = resolveMethodSignatureByNode(node);
                const sourceFilePath = extractFilePathFromMethodSignature(sourceMethodSig);
                const unresolvedByFile = unresolvedThisFieldLoadNodeIdsByFieldAndFile.get(fieldName);
                const unresolvedByClass = sourceFilePath.length > 0 ? unresolvedByFile?.get(sourceFilePath) : undefined;
                const sourceClassSig = resolveObjectClassSignatureByNode(node);
                const unresolvedLoadNodeIds = selectThisFieldFallbackLoads(
                    unresolvedByClass,
                    sourceClassSig,
                    classBySignature,
                    classRelationCache
                );
                if (unresolvedLoadNodeIds) {
                    for (const destVarId of unresolvedLoadNodeIds.values()) {
                        const dstNode = pag.getNode(destVarId) as PagNode;
                        if (!dstNode) continue;
                        if (fact.field.length > 1) {
                            let hasPointTo = false;
                            for (const nestedObjId of dstNode.getPointTo()) {
                                hasPointTo = true;
                                const nestedObjNode = pag.getNode(nestedObjId) as PagNode;
                                if (!nestedObjNode) continue;
                                const newFact = new TaintFact(
                                    nestedObjNode,
                                    fact.source,
                                    currentCtx,
                                    fact.field.slice(1),
                                );
                                tryEnqueue("Load-UnresolvedThisField", newFact, () => {
                                    tracker.markTainted(
                                        nestedObjNode.getID(),
                                        currentCtx,
                                        fact.source,
                                        newFact.field,
                                        newFact.id,
                                    );
                                    log(`    [Load-UnresolvedThisField] Tainted Obj ${nestedObjId}.${newFact.field?.join(".")} from unresolved this.${fieldName} (ctx=${currentCtx})`);
                                });
                            }
                            if (!hasPointTo) {
                                const newFact = new TaintFact(dstNode, fact.source, currentCtx, fact.field.slice(1));
                                tryEnqueue("Load-UnresolvedThisField", newFact, () => {
                                    tracker.markTainted(destVarId, currentCtx, fact.source, newFact.field, newFact.id);
                                    log(`    [Load-UnresolvedThisField] Tainted local ${destVarId}.${newFact.field?.join(".")} from unresolved this.${fieldName} (ctx=${currentCtx})`);
                                });
                            }
                        } else {
                            const newFact = new TaintFact(dstNode, fact.source, currentCtx);
                            tryEnqueue("Load-UnresolvedThisField", newFact, () => {
                                tracker.markTainted(destVarId, currentCtx, fact.source, newFact.field, newFact.id);
                                log(`    [Load-UnresolvedThisField] Tainted var ${destVarId} from unresolved this.${fieldName} (ctx=${currentCtx})`);
                            });
                        }
                    }
                }
            }
        }
        worklist.length = 0;
    }
}
