import { ArkArrayRef, ArkInstanceFieldRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { Pag, PagInstanceFieldNode, PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { ArkMethod } from "../../../arkanalyzer/out/src/core/model/ArkMethod";
import { ArkParameterRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../arkanalyzer/out/src/core/base/Expr";
import { TaintFact } from "../TaintFact";
import { TaintTracker } from "../TaintTracker";
import { TaintContextManager, CallEdgeInfo, CallEdgeType } from "../context/TaintContext";
import { propagateExpressionTaint } from "../ExpressionPropagation";
import { CaptureEdgeInfo } from "./CallEdgeMapBuilder";
import { SyntheticInvokeEdgeInfo, SyntheticConstructorStoreInfo, SyntheticFieldBridgeInfo } from "./SyntheticInvokeEdgeBuilder";
import { WorklistProfiler } from "./WorklistProfiler";
import { PropagationTrace } from "./PropagationTrace";
import { TransferRule } from "../rules/RuleSchema";
import { ConfigBasedTransferExecutor, TransferExecutionResult } from "./ConfigBasedTransferExecutor";
import { buildAppStorageModel } from "../harmony/AppStorageModeling";
import { buildRouterModel } from "../harmony/RouterModeling";
import { buildStateManagementModel } from "../harmony/StateManagementModeling";
import { buildWorkerTaskPoolModel } from "../harmony/WorkerTaskPoolModeling";
import { buildEmitterModel } from "../harmony/EmitterModeling";
import {
    collectPreciseArrayLoadNodeIdsFromTaintedLocal,
    collectContainerSlotLoadNodeIds,
    collectContainerSlotStoresFromTaintedLocal,
    fromContainerFieldKey,
    toContainerFieldKey
} from "./ContainerModel";
import { resolveMethodsFromCallable } from "./CalleeResolver";

interface WorklistSolverDeps {
    scene: Scene;
    pag: Pag;
    tracker: TaintTracker;
    ctxManager: TaintContextManager;
    callEdgeMap: Map<string, CallEdgeInfo>;
    captureEdgeMap: Map<number, CaptureEdgeInfo[]>;
    syntheticInvokeEdgeMap: Map<number, SyntheticInvokeEdgeInfo[]>;
    syntheticConstructorStoreMap: Map<number, SyntheticConstructorStoreInfo[]>;
    syntheticFieldBridgeMap: Map<string, SyntheticFieldBridgeInfo[]>;
    fieldToVarIndex: Map<string, Set<number>>;
    transferRules?: TransferRule[];
    onTransferRuleHit?: (event: TransferExecutionResult) => void;
    getInitialRuleChainForFact?: (fact: TaintFact) => FactRuleChain;
    onFactRuleChain?: (factId: string, chain: FactRuleChain) => void;
    profiler?: WorklistProfiler;
    propagationTrace?: PropagationTrace;
    allowedMethodSignatures?: Set<string>;
    enableHarmonyAppStorageModeling?: boolean;
    enableHarmonyStateModeling?: boolean;
    log: (msg: string) => void;
}

export interface FactRuleChain {
    sourceRuleId?: string;
    transferRuleIds: string[];
}

const ANY_CLASS_SIG = "__ANY_CLASS__";
type ThisFieldFallbackLoadNodeIds = Map<string, Map<string, Map<string, Set<number>>>>;

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
            captureEdgeMap,
            syntheticInvokeEdgeMap,
            syntheticConstructorStoreMap,
            syntheticFieldBridgeMap,
            fieldToVarIndex,
            transferRules,
            onTransferRuleHit,
            getInitialRuleChainForFact,
            onFactRuleChain,
            profiler,
            propagationTrace,
            allowedMethodSignatures,
            enableHarmonyAppStorageModeling,
            enableHarmonyStateModeling,
            log
        } = this.deps;
        const transferExecutor = new ConfigBasedTransferExecutor(transferRules || [], scene);
        const arraySlotObjsByCtx: Map<number, Set<number>> = new Map();
        const appStorageModel = enableHarmonyAppStorageModeling === false
            ? undefined
            : buildAppStorageModel({
                scene,
                pag,
                allowedMethodSignatures,
            });
        const appStorageWriteKeysByNodeId = new Map<number, string[]>();
        const appStorageWriteKeysByFieldEndpoint = new Map<string, string[]>();
        if (appStorageModel) {
            for (const [key, nodeIds] of appStorageModel.writeNodeIdsByKey.entries()) {
                for (const nodeId of nodeIds) {
                    if (!appStorageWriteKeysByNodeId.has(nodeId)) {
                        appStorageWriteKeysByNodeId.set(nodeId, []);
                    }
                    appStorageWriteKeysByNodeId.get(nodeId)!.push(key);
                }
            }
            for (const [key, nodeIds] of appStorageModel.writeFieldNodeIdsByKey.entries()) {
                for (const nodeId of nodeIds) {
                    if (!appStorageWriteKeysByNodeId.has(nodeId)) {
                        appStorageWriteKeysByNodeId.set(nodeId, []);
                    }
                    appStorageWriteKeysByNodeId.get(nodeId)!.push(key);
                }
            }
            for (const [key, endpoints] of appStorageModel.writeFieldEndpointsByKey.entries()) {
                for (const endpoint of endpoints) {
                    const endpointKey = `${endpoint.objectNodeId}#${endpoint.fieldName}`;
                    if (!appStorageWriteKeysByFieldEndpoint.has(endpointKey)) {
                        appStorageWriteKeysByFieldEndpoint.set(endpointKey, []);
                    }
                    appStorageWriteKeysByFieldEndpoint.get(endpointKey)!.push(key);
                }
            }
            if (appStorageModel.dynamicKeyWarnings.length > 0) {
                log(`[Harmony-AppStorage] dynamic key warnings=${appStorageModel.dynamicKeyWarnings.length} (V1 only supports constant keys).`);
            }
        }
        const stateModel = enableHarmonyStateModeling === false
            ? undefined
            : buildStateManagementModel({
                scene,
                pag,
                allowedMethodSignatures,
            });
        if (stateModel && stateModel.bridgeEdgeCount > 0) {
            log(
                `[Harmony-State] bridge_edges=${stateModel.bridgeEdgeCount}, `
                + `constructor_calls=${stateModel.constructorCallCount}, `
                + `state_capture_fields=${stateModel.stateCaptureAssignCount}`
            );
        }
        const workerTaskPoolModel = buildWorkerTaskPoolModel({
            scene,
            pag,
            allowedMethodSignatures,
        });
        if (workerTaskPoolModel.bridgeCount > 0) {
            log(
                `[Harmony-WorkerTaskPool] bridge_edges=${workerTaskPoolModel.bridgeCount}, `
                + `worker_registrations=${workerTaskPoolModel.workerRegistrationCount}, `
                + `worker_sends=${workerTaskPoolModel.workerSendCount}, `
                + `taskpool_executes=${workerTaskPoolModel.taskpoolExecuteCount}`
            );
        }
        const emitterModel = buildEmitterModel({
            scene,
            pag,
            allowedMethodSignatures,
        });
        if (emitterModel.onRegistrationCount > 0 || emitterModel.emitCount > 0) {
            log(
                `[Harmony-Emitter] on_registrations=${emitterModel.onRegistrationCount}, `
                + `emits=${emitterModel.emitCount}, `
                + `bridge_edges=${emitterModel.bridgeCount}, `
                + `dynamic_event_skips=${emitterModel.dynamicEventSkipCount}`
            );
        }
        const routerModel = buildRouterModel({
            scene,
            pag,
            allowedMethodSignatures,
            log,
        });
        const routerBridgeCount = Array.from(routerModel.getResultNodeIdsByRouterKey.values())
            .reduce((acc, ids) => acc + ids.size, 0);
        if (routerModel.pushCallCount > 0 || routerModel.getCallCount > 0) {
            log(
                `[Harmony-Router] push_calls=${routerModel.pushCallCount}, `
                + `get_calls=${routerModel.getCallCount}, `
                + `bridged_nodes=${routerBridgeCount}, `
                + `suspicious_calls=${routerModel.suspiciousCallCount}, `
                + `ungrouped_push_nodes=${routerModel.ungroupedPushNodeIds.size}`
            );
        }
        const loggedRouterConservativeSkips = new Set<string>();
        const appStorageSlotTaintStates = new Set<string>();
        const unresolvedThisFieldLoadNodeIdsByFieldAndFile = this.buildUnresolvedThisFieldLoadNodeIdsByFieldAndFile(
            scene,
            pag,
            allowedMethodSignatures
        );
        const classBySignature = this.buildClassSignatureIndex(scene);
        const classRelationCache = new Map<string, boolean>();
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
        for (const seedFact of worklist) {
            const chain = initialChainForFact(seedFact);
            factRuleChains.set(seedFact.id, chain);
            onFactRuleChain?.(seedFact.id, chain);
        }
        profiler?.onQueueSize(worklist.length);

        while (worklist.length > 0) {
            const fact = worklist.shift()!;
            profiler?.onDequeue(worklist.length);
            propagationTrace?.recordFact(fact);
            const node = fact.node;
            const currentCtx = fact.contextID;
            const currentChain = factRuleChains.get(fact.id) || initialChainForFact(fact);
            factRuleChains.set(fact.id, currentChain);
            onFactRuleChain?.(fact.id, currentChain);
            if (!this.isNodeAllowedByReachability(node, allowedMethodSignatures)) {
                continue;
            }

            const tryEnqueue = (
                reason: string,
                newFact: TaintFact,
                onAccepted: () => void,
                chainOverride?: FactRuleChain
            ): void => {
                if (!this.isNodeAllowedByReachability(newFact.node, allowedMethodSignatures)) {
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
                profiler?.onEnqueueSuccess(reason, worklist.length);
                propagationTrace?.recordEdge(fact, newFact, reason);
                onAccepted();
            };

            if (appStorageModel) {
                const writeKeySet = new Set<string>(appStorageWriteKeysByNodeId.get(node.getID()) || []);
                if (fact.field && fact.field.length > 0) {
                    const endpointKey = `${node.getID()}#${fact.field[0]}`;
                    const endpointKeys = appStorageWriteKeysByFieldEndpoint.get(endpointKey) || [];
                    for (const key of endpointKeys) {
                        writeKeySet.add(key);
                    }
                }
                const writeKeys = [...writeKeySet];
                for (const key of writeKeys) {
                    const slotStateKey = `${key}|${fact.source}|${currentCtx}|${fact.field ? fact.field.join(".") : ""}`;
                    if (appStorageSlotTaintStates.has(slotStateKey)) continue;
                    appStorageSlotTaintStates.add(slotStateKey);

                    const readNodeIds = appStorageModel.readNodeIdsByKey.get(key);
                    if (readNodeIds) {
                        for (const readNodeId of readNodeIds) {
                            const readNode = pag.getNode(readNodeId) as PagNode;
                            if (!readNode) continue;
                            const newFact = new TaintFact(
                                readNode,
                                fact.source,
                                currentCtx,
                                fact.field ? [...fact.field] : undefined
                            );
                            tryEnqueue("AppStorage-Read", newFact, () => {
                                tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                                log(`    [AppStorage-Read] key='${key}' -> node ${newFact.node.getID()} (ctx=${newFact.contextID})`);
                            });
                        }
                    }

                    const readFieldNodeIds = appStorageModel.readFieldNodeIdsByKey.get(key);
                    if (readFieldNodeIds) {
                        for (const fieldNodeId of readFieldNodeIds) {
                            const fieldNode = pag.getNode(fieldNodeId) as PagNode;
                            if (!fieldNode) continue;
                            const newFact = new TaintFact(
                                fieldNode,
                                fact.source,
                                currentCtx,
                                fact.field ? [...fact.field] : undefined
                            );
                            tryEnqueue("AppStorage-DecorFieldNode", newFact, () => {
                                tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                                log(`    [AppStorage-DecorFieldNode] key='${key}' -> fieldNode ${fieldNodeId} (ctx=${newFact.contextID})`);
                            });
                        }
                    }

                    const fieldEndpoints = appStorageModel.readFieldEndpointsByKey.get(key) || [];
                    for (const endpoint of fieldEndpoints) {
                        const objectNode = pag.getNode(endpoint.objectNodeId) as PagNode;
                        if (!objectNode) continue;
                        const isSelfEndpointEcho = fact.node.getID() === endpoint.objectNodeId
                            && !!fact.field
                            && fact.field.length > 0
                            && fact.field[0] === endpoint.fieldName;
                        if (isSelfEndpointEcho) continue;
                        // AppStorage slot bridging should reset to the decorated field path.
                        // Re-prepending existing field chains can create unbounded growth loops.
                        const fieldPath = [endpoint.fieldName];
                        const newFact = new TaintFact(
                            objectNode,
                            fact.source,
                            currentCtx,
                            fieldPath
                        );
                        tryEnqueue("AppStorage-Decor", newFact, () => {
                            tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                            log(`    [AppStorage-Decor] key='${key}' -> Obj ${endpoint.objectNodeId}.${endpoint.fieldName} (ctx=${newFact.contextID})`);
                        });
                    }
                }
            }

            const workerTargetNodeIds = workerTaskPoolModel.forwardTargetNodeIdsBySourceNodeId.get(node.getID());
            if (workerTargetNodeIds && workerTargetNodeIds.size > 0) {
                for (const targetNodeId of workerTargetNodeIds) {
                    const targetNode = pag.getNode(targetNodeId) as PagNode;
                    if (!targetNode) continue;
                    const newFact = new TaintFact(
                        targetNode,
                        fact.source,
                        currentCtx,
                        fact.field ? [...fact.field] : undefined
                    );
                    tryEnqueue("Harmony-WorkerTaskPool", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(
                            `    [Harmony-WorkerTaskPool] node ${fact.node.getID()} `
                            + `-> node ${targetNodeId} (ctx=${newFact.contextID})`
                        );
                    });
                }
            }

            const emitterTargetNodeIds = emitterModel.forwardTargetNodeIdsBySourceNodeId.get(node.getID());
            if (emitterTargetNodeIds && emitterTargetNodeIds.size > 0) {
                for (const targetNodeId of emitterTargetNodeIds) {
                    const targetNode = pag.getNode(targetNodeId) as PagNode;
                    if (!targetNode) continue;
                    const newFact = new TaintFact(
                        targetNode,
                        fact.source,
                        currentCtx,
                        fact.field ? [...fact.field] : undefined
                    );
                    tryEnqueue("Harmony-Emitter", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(
                            `    [Harmony-Emitter] node ${fact.node.getID()} `
                            + `-> callback param node ${targetNodeId} (ctx=${newFact.contextID})`
                        );
                    });
                }
            }

            const routerKeys = routerModel.pushArgNodeIdToRouterKeys.get(node.getID());
            if (routerKeys && routerKeys.size > 0) {
                for (const routerKey of routerKeys) {
                    const targetNodeIds = routerModel.getResultNodeIdsByRouterKey.get(routerKey);
                    if (!targetNodeIds || targetNodeIds.size === 0) continue;
                    if (routerModel.ungroupedPushNodeIds.has(node.getID())) {
                        const pushCount = routerModel.pushCallCountByRouterKey.get(routerKey) || 0;
                        const routeCount = routerModel.distinctRouteKeyCountByRouterKey.get(routerKey) || 0;
                        const hasAmbiguousTargets = targetNodeIds.size > 1;
                        const hasAmbiguousRoutes = routeCount === 0 || routeCount > 1;
                        if (pushCount > 1 && hasAmbiguousTargets && hasAmbiguousRoutes) {
                            const skipKey = `${routerKey}:${node.getID()}`;
                            if (!loggedRouterConservativeSkips.has(skipKey)) {
                                loggedRouterConservativeSkips.add(skipKey);
                                log(
                                    `[Harmony-Router] conservative skip for ungrouped push node=${node.getID()} `
                                    + `(router=${routerKey}, pushCount=${pushCount}, routeCount=${routeCount})`
                                );
                            }
                            continue;
                        }
                    }
                    for (const targetNodeId of targetNodeIds) {
                        const targetNode = pag.getNode(targetNodeId) as PagNode;
                        if (!targetNode) continue;
                        const newFact = new TaintFact(
                            targetNode,
                            fact.source,
                            currentCtx,
                            fact.field ? [...fact.field] : undefined
                        );
                        tryEnqueue("Harmony-RouterBridge", newFact, () => {
                            tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                            log(
                                `    [Harmony-RouterBridge] node ${fact.node.getID()} `
                                + `-> getParams node ${targetNodeId} (ctx=${newFact.contextID})`
                            );
                        });
                    }
                }
            }

            if (stateModel && fact.field && fact.field.length > 0) {
                const sourceFieldName = fact.field[0];
                const sourceKey = `${node.getID()}#${sourceFieldName}`;
                const bridgeEdges = stateModel.edgesBySourceField.get(sourceKey) || [];
                for (const edge of bridgeEdges) {
                    const targetObjectNode = pag.getNode(edge.targetObjectNodeId) as PagNode;
                    if (!targetObjectNode) continue;
                    const targetFieldPath = fact.field.length > 1
                        ? [edge.targetFieldName, ...fact.field.slice(1)]
                        : [edge.targetFieldName];
                    const newFact = new TaintFact(
                        targetObjectNode,
                        fact.source,
                        currentCtx,
                        targetFieldPath
                    );
                    tryEnqueue("Harmony-StateProp", newFact, () => {
                        tracker.markTainted(
                            newFact.node.getID(),
                            newFact.contextID,
                            fact.source,
                            newFact.field,
                            newFact.id
                        );
                        log(
                            `    [Harmony-StateProp] Obj ${edge.sourceObjectNodeId}.${edge.sourceFieldName} `
                            + `-> Obj ${edge.targetObjectNodeId}.${edge.targetFieldName} (ctx=${currentCtx})`
                        );
                    });
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
                pag
            );
            for (const targetNodeId of exprTargetNodes) {
                const targetNode = pag.getNode(targetNodeId) as PagNode;
                const newFact = new TaintFact(targetNode, fact.source, currentCtx, fact.field);
                tryEnqueue("Expr", newFact, () => {
                    tracker.markTainted(targetNodeId, currentCtx, fact.source, newFact.field, newFact.id);
                    log(`    [Expr] Tainted node ${targetNodeId} (ctx=${currentCtx})`);
                });
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
                const val = node.getValue();
                if (val instanceof Local) {
                    const preciseArrayLoads = collectPreciseArrayLoadNodeIdsFromTaintedLocal(val, pag);
                    for (const dstId of preciseArrayLoads) {
                        const dstNode = pag.getNode(dstId) as PagNode;
                        const newFact = new TaintFact(dstNode, fact.source, currentCtx);
                        tryEnqueue("Array-Precise", newFact, () => {
                            tracker.markTainted(dstId, currentCtx, fact.source, newFact.field, newFact.id);
                            log(`    [Array-Precise] Tainted var ${dstId} by precise array path (ctx=${currentCtx})`);
                        });
                    }

                    const slotStores = collectContainerSlotStoresFromTaintedLocal(val, pag);
                    for (const info of slotStores) {
                        const objNode = pag.getNode(info.objId) as PagNode;
                        const fieldKey = toContainerFieldKey(info.slot);
                        const newFact = new TaintFact(objNode, fact.source, currentCtx, [fieldKey]);
                        tryEnqueue("Container-Store", newFact, () => {
                            tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                            log(`    [Container-Store] Tainted slot '${info.slot}' of Obj ${info.objId} (ctx=${currentCtx})`);
                        });

                        if (info.slot.startsWith("arr:")) {
                            if (!arraySlotObjsByCtx.has(currentCtx)) {
                                arraySlotObjsByCtx.set(currentCtx, new Set<number>());
                            }
                            arraySlotObjsByCtx.get(currentCtx)!.add(info.objId);
                        }
                    }

                }
            }

            if (!fact.field || fact.field.length === 0) {
                const capturedFieldFacts = this.propagateCapturedFieldWrites(node, fact.source, currentCtx);
                for (const newFact of capturedFieldFacts) {
                    tryEnqueue("Capture-Store", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Capture-Store] Tainted field '${newFact.field?.[0]}' of Obj ${newFact.node.getID()} (ctx=${currentCtx})`);
                    });
                }
            }

            const captureEdges = captureEdgeMap.get(node.getID());
            if (captureEdges && (!fact.field || fact.field.length === 0)) {
                for (const captureEdge of captureEdges) {
                    const targetNode = pag.getNode(captureEdge.dstNodeId) as PagNode;
                    const newCtx = ctxManager.createCalleeContext(
                        currentCtx,
                        captureEdge.callSiteId,
                        captureEdge.callerMethodName,
                        captureEdge.calleeMethodName
                    );
                    const newFact = new TaintFact(targetNode, fact.source, newCtx);
                    tryEnqueue("Capture", newFact, () => {
                        tracker.markTainted(captureEdge.dstNodeId, newCtx, fact.source, newFact.field, newFact.id);
                        log(`    [Capture] ${captureEdge.callerMethodName} -> ${captureEdge.calleeMethodName}, node ${node.getID()} -> ${captureEdge.dstNodeId}, ctx: ${currentCtx} -> ${newCtx}`);
                    });
                }
            }

            const syntheticEdges = syntheticInvokeEdgeMap.get(node.getID());
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

            if (!fact.field || fact.field.length === 0) {
                const promiseCallbackFacts = this.propagatePromiseCallbackParams(scene, node, fact.source, currentCtx);
                for (const newFact of promiseCallbackFacts) {
                    tryEnqueue("Promise-CB", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Promise-CB] Tainted callback param node ${newFact.node.getID()} (ctx=${newFact.contextID})`);
                    });
                }
            }

            if (!fact.field || fact.field.length === 0) {
                const promiseArgFacts = this.propagatePromiseCallbacksFromTaintedArg(scene, node, fact.source, currentCtx);
                for (const newFact of promiseArgFacts) {
                    tryEnqueue("Promise-Arg", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Promise-Arg] Tainted callback param node ${newFact.node.getID()} (ctx=${newFact.contextID})`);
                    });
                }
            }

            if (!fact.field || fact.field.length === 0) {
                const restArgFacts = this.propagateRestArrayParam(scene, node, fact.source, currentCtx);
                for (const newFact of restArgFacts) {
                    tryEnqueue("Rest-Arg", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Rest-Arg] Tainted rest param node ${newFact.node.getID()} (ctx=${newFact.contextID})`);
                    });
                }
            }

            if (!fact.field || fact.field.length === 0) {
                const arrayLoadFacts = this.propagateArrayElementLoads(node, fact.source, currentCtx);
                for (const newFact of arrayLoadFacts) {
                    tryEnqueue("Array-Load", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Array-Load] Tainted array read node ${newFact.node.getID()} (ctx=${newFact.contextID})`);
                    });
                }
            }

            const copyEdges = node.getOutgoingCopyEdges();
            if (copyEdges && (!fact.field || fact.field.length === 0)) {
                for (const edge of copyEdges) {
                    if (this.shouldSuppressBroadArrayFieldCopy(node, currentCtx, arraySlotObjsByCtx)) {
                        continue;
                    }

                    const targetNodeId = edge.getDstID();
                    const targetNode = pag.getNode(targetNodeId) as PagNode;
                    const edgeKey = `${node.getID()}->${targetNodeId}`;

                    const callEdgeInfo = callEdgeMap.get(edgeKey);
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
                    }

                    const newFact = new TaintFact(targetNode, fact.source, newCtx);
                    tryEnqueue("Copy", newFact, () => {
                        tracker.markTainted(targetNodeId, newCtx, fact.source, newFact.field, newFact.id);
                        log(`    [Copy] Tainted node ${targetNodeId} (from ${node.getID()}, ctx=${newCtx})`);
                    });
                }
            }

            if (!fact.field || fact.field.length === 0) {
                const writeEdges = node.getOutgoingWriteEdges();
                if (writeEdges) {
                    for (const edge of writeEdges) {
                        const fieldNode = pag.getNode(edge.getDstID());
                        if (!(fieldNode instanceof PagInstanceFieldNode)) continue;

                        const fieldRef = fieldNode.getValue() as ArkInstanceFieldRef;
                        const fieldName = fieldRef.getFieldSignature().getFieldName();
                        const baseLocal = fieldRef.getBase();
                        const baseNodesMap = pag.getNodesByValue(baseLocal);
                        if (!baseNodesMap) continue;

                        for (const baseNodeId of baseNodesMap.values()) {
                            const baseNode = pag.getNode(baseNodeId) as PagNode;
                            const pts = baseNode.getPointTo();
                            for (const objId of pts) {
                                const objNode = pag.getNode(objId) as PagNode;
                                const newFact = new TaintFact(objNode, fact.source, currentCtx, [fieldName]);
                                tryEnqueue("Store", newFact, () => {
                                    tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                                    log(`    [Store] Tainted field '${fieldName}' of Obj ${objId} (ctx=${currentCtx})`);
                                });
                            }
                        }
                    }
                }
            }

            if (fact.field && fact.field.length > 0) {
                const reflectFacts = this.propagateReflectGetFieldLoadsByObj(node.getID(), fact.field[0], fact.source, currentCtx);
                for (const newFact of reflectFacts) {
                    tryEnqueue("Reflect-Load", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Reflect-Load] Tainted var ${newFact.node.getID()} from Reflect.get field '${fact.field[0]}' (ctx=${currentCtx})`);
                    });
                }
            }

            if (fact.field && fact.field.length > 0) {
                const objId = fact.node.getID();
                const fieldName = fact.field[0];

                const containerSlot = fromContainerFieldKey(fieldName);
                if (containerSlot !== null) {
                    const loadNodeIds = collectContainerSlotLoadNodeIds(objId, containerSlot, pag, scene);
                    for (const loadNodeId of loadNodeIds) {
                        const dstNode = pag.getNode(loadNodeId) as PagNode;
                        const newFact = new TaintFact(dstNode, fact.source, currentCtx);
                        tryEnqueue("Container-Load", newFact, () => {
                            tracker.markTainted(loadNodeId, currentCtx, fact.source, newFact.field, newFact.id);
                            log(`    [Container-Load] Tainted var ${loadNodeId} from Obj ${objId}[${containerSlot}] (ctx=${currentCtx})`);
                        });
                    }
                }

                const key = `${objId}-${fieldName}`;
                const destVarIds = fieldToVarIndex.get(key);
                if (destVarIds) {
                    for (const destVarId of destVarIds) {
                        const dstNode = pag.getNode(destVarId) as PagNode;
                        if (!dstNode) continue;

                        const newFact = new TaintFact(dstNode, fact.source, currentCtx);
                        tryEnqueue("Load", newFact, () => {
                            tracker.markTainted(destVarId, currentCtx, fact.source, newFact.field, newFact.id);
                            log(`    [Load] Tainted var ${destVarId} from Obj ${objId}.${fieldName} (ctx=${currentCtx})`);
                        });
                    }
                }

                const sourceMethodSig = this.resolveMethodSignatureByNode(node);
                const sourceFilePath = this.extractFilePathFromMethodSignature(sourceMethodSig);
                const unresolvedByFile = unresolvedThisFieldLoadNodeIdsByFieldAndFile.get(fieldName);
                const unresolvedByClass = sourceFilePath.length > 0 ? unresolvedByFile?.get(sourceFilePath) : undefined;
                const sourceClassSig = this.resolveObjectClassSignatureByNode(node);
                const unresolvedLoadNodeIds = this.selectThisFieldFallbackLoads(
                    unresolvedByClass,
                    sourceClassSig,
                    classBySignature,
                    classRelationCache
                );
                if (unresolvedLoadNodeIds) {
                    for (const destVarId of unresolvedLoadNodeIds.values()) {
                        const dstNode = pag.getNode(destVarId) as PagNode;
                        if (!dstNode) continue;
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

    private shouldSuppressBroadArrayFieldCopy(
        node: PagNode,
        currentCtx: number,
        arraySlotObjsByCtx: Map<number, Set<number>>
    ): boolean {
        if (!(node instanceof PagInstanceFieldNode)) return false;
        const fieldRef = node.getValue();
        if (!(fieldRef instanceof ArkInstanceFieldRef)) return false;
        const fieldSigText = fieldRef.getFieldSignature().toString();
        if (!fieldSigText.includes("Array.field")) return false;

        const { pag } = this.deps;
        const baseLocal = fieldRef.getBase();
        const baseNodes = pag.getNodesByValue(baseLocal);
        if (!baseNodes) return false;

        const slotObjs = arraySlotObjsByCtx.get(currentCtx);
        if (!slotObjs || slotObjs.size === 0) return false;

        for (const baseNodeId of baseNodes.values()) {
            const baseNode = pag.getNode(baseNodeId) as PagNode;
            for (const objId of baseNode.getPointTo()) {
                if (slotObjs.has(objId)) {
                    return true;
                }
            }
        }
        return false;
    }

    private propagateReflectGetFieldLoadsByObj(
        taintedObjId: number,
        fieldName: string,
        source: string,
        currentCtx: number
    ): TaintFact[] {
        const { pag } = this.deps;
        const results: TaintFact[] = [];
        for (const rawNode of pag.getNodesIter()) {
            const aliasNode = rawNode as PagNode;

            const val = aliasNode.getValue();
            if (!(val instanceof Local)) continue;
            const pts = aliasNode.getPointTo();
            const pointsToTarget = pts ? pts.contains(taintedObjId) : false;
            if (!pointsToTarget) continue;

            for (const stmt of val.getUsedStmts()) {
                if (!(stmt instanceof ArkAssignStmt)) continue;
                const rightOp = stmt.getRightOp();
                if (!(rightOp instanceof ArkStaticInvokeExpr) && !(rightOp instanceof ArkInstanceInvokeExpr)) continue;

                const sig = rightOp.getMethodSignature()?.toString() || "";
                const isReflectLikeGet = sig.includes("Reflect.get") || sig.includes(".get()");
                if (!isReflectLikeGet) continue;

                const args = rightOp.getArgs ? rightOp.getArgs() : [];
                if (args.length < 2) continue;
                if (args[0] !== val) continue;

                const keyText = `${args[1]}`;
                const normalizedField = keyText.replace(/^['"`]/, "").replace(/['"`]$/, "");
                if (normalizedField !== fieldName) continue;

                const leftOp = stmt.getLeftOp();
                const dstNodes = pag.getNodesByValue(leftOp);
                if (!dstNodes) continue;
                for (const dstNodeId of dstNodes.values()) {
                    const dstNode = pag.getNode(dstNodeId) as PagNode;
                    results.push(new TaintFact(dstNode, source, currentCtx));
                }
            }
        }

        return results;
    }

    private propagateRestArrayParam(
        scene: Scene,
        taintedNode: PagNode,
        source: string,
        currentCtx: number
    ): TaintFact[] {
        const { pag, ctxManager } = this.deps;
        const results: TaintFact[] = [];
        const val = taintedNode.getValue();
        if (!(val instanceof Local)) return results;

        for (const stmt of val.getUsedStmts()) {
            if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!(invokeExpr instanceof ArkStaticInvokeExpr) && !(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;

            const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            if (args.length <= 1 || !args.includes(val)) continue;

            const calleeSig = invokeExpr.getMethodSignature()?.toString() || "";
            if (!calleeSig.includes("[]")) continue;

            const callee = scene.getMethods().find(m => m.getSignature().toString() === calleeSig);
            if (!callee || !callee.getCfg()) continue;

            const paramAssigns = callee.getCfg()!.getStmts()
                .filter((s: any) => s instanceof ArkAssignStmt && s.getRightOp() instanceof ArkParameterRef) as ArkAssignStmt[];
            if (paramAssigns.length !== 1) continue;

            let dstNodes = pag.getNodesByValue(paramAssigns[0].getLeftOp());
            if (!dstNodes || dstNodes.size === 0) {
                dstNodes = pag.getNodesByValue(paramAssigns[0].getRightOp());
            }
            if (!dstNodes || dstNodes.size === 0) continue;

            const callSiteId = stmt.getOriginPositionInfo().getLineNo() * 10000 + this.simpleHash(calleeSig);
            const newCtx = ctxManager.createCalleeContext(
                currentCtx,
                callSiteId,
                "<rest_arg_dispatch>",
                callee.getName()
            );

            for (const dstNodeId of dstNodes.values()) {
                const dstNode = pag.getNode(dstNodeId) as PagNode;
                results.push(new TaintFact(dstNode, source, newCtx));
            }
        }

        return results;
    }

    private simpleHash(s: string): number {
        let h = 0;
        for (let i = 0; i < s.length; i++) {
            h = ((h << 5) - h) + s.charCodeAt(i);
            h |= 0;
        }
        return Math.abs(h % 10000);
    }

    private propagateArrayElementLoads(
        taintedNode: PagNode,
        source: string,
        currentCtx: number
    ): TaintFact[] {
        const { pag } = this.deps;
        const results: TaintFact[] = [];
        const val = taintedNode.getValue();
        if (!(val instanceof Local)) return results;

        for (const stmt of val.getUsedStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const rightOp = stmt.getRightOp();
            if (!(rightOp instanceof ArkArrayRef)) continue;
            if (rightOp.getBase() !== val) continue;

            const leftOp = stmt.getLeftOp();
            const dstNodes = pag.getNodesByValue(leftOp);
            if (!dstNodes) continue;
            for (const dstNodeId of dstNodes.values()) {
                const dstNode = pag.getNode(dstNodeId) as PagNode;
                results.push(new TaintFact(dstNode, source, currentCtx));
            }
        }

        return results;
    }

    private propagateCapturedFieldWrites(
        taintedNode: PagNode,
        source: string,
        currentCtx: number
    ): TaintFact[] {
        const { pag } = this.deps;
        const results: TaintFact[] = [];
        const val = taintedNode.getValue();
        if (!(val instanceof Local)) return results;

        for (const stmt of val.getUsedStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const leftOp = stmt.getLeftOp();
            if (!(leftOp instanceof ArkInstanceFieldRef)) continue;

            const rightOp = stmt.getRightOp();
            if (!(rightOp instanceof Local)) continue;
            if (rightOp !== val) continue;

            const fieldName = leftOp.getFieldSignature().getFieldName();
            const baseLocal = leftOp.getBase();
            const baseNodesMap = pag.getNodesByValue(baseLocal);
            if (!baseNodesMap) continue;

            for (const baseNodeId of baseNodesMap.values()) {
                const baseNode = pag.getNode(baseNodeId) as PagNode;
                for (const objId of baseNode.getPointTo()) {
                    const objNode = pag.getNode(objId) as PagNode;
                    results.push(new TaintFact(objNode, source, currentCtx, [fieldName]));
                }
            }
        }
        return results;
    }

    private propagatePromiseCallbackParams(
        scene: Scene,
        taintedNode: PagNode,
        source: string,
        currentCtx: number
    ): TaintFact[] {
        const { pag } = this.deps;
        const results: TaintFact[] = [];
        const val = taintedNode.getValue();
        if (!(val instanceof Local)) return results;

        results.push(...this.collectPromiseCallbackFactsByReceiverLocal(scene, val, source, currentCtx));

        return results;
    }

    private propagatePromiseCallbacksFromTaintedArg(
        scene: Scene,
        taintedNode: PagNode,
        source: string,
        currentCtx: number
    ): TaintFact[] {
        const results: TaintFact[] = [];
        const val = taintedNode.getValue();
        if (!(val instanceof Local)) return results;

        for (const stmt of val.getUsedStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const rightOp = stmt.getRightOp();
            if (!(rightOp instanceof ArkStaticInvokeExpr) && !(rightOp instanceof ArkInstanceInvokeExpr)) continue;

            const args = rightOp.getArgs ? rightOp.getArgs() : [];
            if (!args.includes(val)) continue;

            const leftOp = stmt.getLeftOp();
            if (!(leftOp instanceof Local)) continue;

            results.push(...this.collectPromiseCallbackFactsByReceiverLocal(scene, leftOp, source, currentCtx));
        }

        return results;
    }

    private collectPromiseCallbackFactsByReceiverLocal(
        scene: Scene,
        receiverLocal: Local,
        source: string,
        currentCtx: number
    ): TaintFact[] {
        const { pag } = this.deps;
        const results: TaintFact[] = [];

        for (const stmt of receiverLocal.getUsedStmts()) {
            if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
            if (invokeExpr.getBase() !== receiverLocal) continue;

            const sig = invokeExpr.getMethodSignature()?.toString() || "";
            const isThen = sig.includes(".then()");
            const isCatch = sig.includes(".catch()");
            const isFinally = sig.includes(".finally()");
            if (!isThen && !isCatch && !isFinally) continue;

            const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            if (args.length === 0) continue;
            const callbackArg = args[0];
            const callbackMethods = this.resolveCallbackMethods(scene, callbackArg);
            for (const cbMethod of callbackMethods) {
                const cfg = cbMethod.getCfg();
                if (!cfg) continue;

                const paramAssigns = cfg.getStmts()
                    .filter((s: any) => s instanceof ArkAssignStmt && s.getRightOp() instanceof ArkParameterRef) as ArkAssignStmt[];
                if (paramAssigns.length === 0) continue;

                for (const pStmt of paramAssigns) {
                    const rightOp = pStmt.getRightOp();
                    const rightText = rightOp.toString();
                    if (rightText.includes("[") && rightText.includes("]")) {
                        if (!isFinally) continue;
                    }

                    const leftOp = pStmt.getLeftOp();
                    const nodes = pag.getNodesByValue(leftOp);
                    if (!nodes) continue;
                    for (const nid of nodes.values()) {
                        const n = pag.getNode(nid) as PagNode;
                        results.push(new TaintFact(n, source, currentCtx));
                    }
                }

                if (isFinally) {
                    const body = cbMethod.getBody();
                    if (body) {
                        for (const local of body.getLocals().values()) {
                            const nodes = pag.getNodesByValue(local);
                            if (!nodes) continue;
                            for (const nid of nodes.values()) {
                                const n = pag.getNode(nid) as PagNode;
                                results.push(new TaintFact(n, source, currentCtx));
                            }
                        }
                    }
                }
            }

            if (stmt instanceof ArkAssignStmt) {
                const chainLocal = stmt.getLeftOp();
                const chainNodes = pag.getNodesByValue(chainLocal);
                if (chainNodes) {
                    for (const nid of chainNodes.values()) {
                        const n = pag.getNode(nid) as PagNode;
                        results.push(new TaintFact(n, source, currentCtx));
                    }
                }
            }
        }
        return results;
    }

    private resolveCallbackMethods(scene: Scene, callbackArg: any): ArkMethod[] {
        const methods: ArkMethod[] = [];
        const seen = new Set<string>();

        const addMethod = (method: ArkMethod): void => {
            const sig = method?.getSignature?.().toString?.();
            if (!sig || seen.has(sig)) return;
            seen.add(sig);
            methods.push(method);
        };

        const callableMethods = resolveMethodsFromCallable(scene, callbackArg, { maxCandidates: 8 });
        for (const method of callableMethods) {
            addMethod(method as ArkMethod);
        }

        if (methods.length > 0) return methods;

        const candidateNames = new Set<string>();

        if (callbackArg instanceof Local) {
            candidateNames.add(callbackArg.getName());
        }
        const txt = callbackArg?.toString?.() || "";
        if (txt) candidateNames.add(txt);

        for (const name of candidateNames) {
            const matched = scene.getMethods().filter(m => m.getName() === name);
            for (const m of matched) addMethod(m);
        }
        return methods;
    }

    private isNodeAllowedByReachability(node: PagNode, allowedMethodSignatures?: Set<string>): boolean {
        if (!allowedMethodSignatures || allowedMethodSignatures.size === 0) return true;
        const methodSig = this.resolveMethodSignatureByNode(node);
        if (!methodSig) return true;
        return allowedMethodSignatures.has(methodSig);
    }

    private resolveMethodSignatureByNode(node: PagNode): string | undefined {
        const stmt = node.getStmt?.();
        const stmtSig = stmt?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.();
        if (stmtSig) return stmtSig;

        const funcSig = (node as any).getMethod?.()?.toString?.();
        if (funcSig) return funcSig;

        const value = node.getValue?.();
        return this.resolveMethodSignatureByValue(value);
    }

    private resolveMethodSignatureByValue(value: any): string | undefined {
        if (!value) return undefined;
        if (value instanceof Local) {
            const declStmt = value.getDeclaringStmt?.();
            const sig = declStmt?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.();
            if (sig) return sig;
        }
        if (value instanceof ArkInstanceFieldRef || value instanceof ArkArrayRef) {
            const base = value.getBase?.();
            return this.resolveMethodSignatureByValue(base);
        }
        const valueSig = value.getMethodSignature?.()?.toString?.();
        if (valueSig) return valueSig;
        return undefined;
    }

    private extractFilePathFromMethodSignature(methodSig?: string): string {
        if (!methodSig) return "";
        const m = methodSig.match(/@([^:>]+):/);
        return m ? m[1].replace(/\\/g, "/") : "";
    }

    private buildClassSignatureIndex(scene: Scene): Map<string, any> {
        const out = new Map<string, any>();
        for (const cls of scene.getClasses()) {
            const sig = cls.getSignature?.().toString?.() || "";
            if (!sig) continue;
            out.set(sig, cls);
        }
        return out;
    }

    private resolveObjectClassSignatureByNode(node: PagNode): string | undefined {
        const value: any = node?.getValue?.();
        const fromType = value?.getType?.()?.getClassSignature?.()?.toString?.();
        if (fromType) return fromType;
        const direct = value?.getClassSignature?.()?.toString?.();
        if (direct) return direct;
        return undefined;
    }

    private isSameOrSubtypeClassSignature(
        sourceClassSig: string,
        targetClassSig: string,
        classBySignature: Map<string, any>,
        relationCache: Map<string, boolean>
    ): boolean {
        if (!sourceClassSig || !targetClassSig) return false;
        if (sourceClassSig === targetClassSig) return true;
        const cacheKey = `${sourceClassSig}=>${targetClassSig}`;
        const cached = relationCache.get(cacheKey);
        if (cached !== undefined) return cached;

        let matched = false;
        let current = classBySignature.get(sourceClassSig);
        const visited = new Set<string>();
        while (current) {
            const currentSig = current.getSignature?.().toString?.() || "";
            if (!currentSig || visited.has(currentSig)) break;
            if (currentSig === targetClassSig) {
                matched = true;
                break;
            }
            visited.add(currentSig);
            current = current.getSuperClass?.();
        }
        relationCache.set(cacheKey, matched);
        return matched;
    }

    private selectThisFieldFallbackLoads(
        classMap: Map<string, Set<number>> | undefined,
        sourceClassSig: string | undefined,
        classBySignature: Map<string, any>,
        relationCache: Map<string, boolean>
    ): Set<number> | undefined {
        if (!classMap || classMap.size === 0) return undefined;

        const out = new Set<number>();
        if (sourceClassSig) {
            for (const [targetClassSig, nodeIds] of classMap.entries()) {
                if (targetClassSig === ANY_CLASS_SIG) continue;
                if (!this.isSameOrSubtypeClassSignature(sourceClassSig, targetClassSig, classBySignature, relationCache)) {
                    continue;
                }
                for (const nodeId of nodeIds) out.add(nodeId);
            }
        }

        const anyClassNodes = classMap.get(ANY_CLASS_SIG);
        if (anyClassNodes) {
            for (const nodeId of anyClassNodes) out.add(nodeId);
        }

        return out.size > 0 ? out : undefined;
    }

    private buildUnresolvedThisFieldLoadNodeIdsByFieldAndFile(
        scene: Scene,
        pag: Pag,
        allowedMethodSignatures?: Set<string>
    ): ThisFieldFallbackLoadNodeIds {
        const out: ThisFieldFallbackLoadNodeIds = new Map();
        const methods = scene.getMethods().filter(m => m.getName() !== "%dflt");
        for (const method of methods) {
            const methodSig = method.getSignature().toString();
            if (allowedMethodSignatures && allowedMethodSignatures.size > 0 && !allowedMethodSignatures.has(methodSig)) {
                continue;
            }
            const cfg = method.getCfg();
            if (!cfg) continue;

            for (const stmt of cfg.getStmts()) {
                if (!(stmt instanceof ArkAssignStmt)) continue;
                const left = stmt.getLeftOp();
                const right = stmt.getRightOp();
                if (!(left instanceof Local) || !(right instanceof ArkInstanceFieldRef)) continue;

                const base = right.getBase();
                if (!(base instanceof Local) || base.getName() !== "this") continue;

                let leftNodes = pag.getNodesByValue(left);
                if (!leftNodes || leftNodes.size === 0) {
                    pag.addPagNode(0, left, stmt);
                    leftNodes = pag.getNodesByValue(left);
                }
                if (!leftNodes || leftNodes.size === 0) continue;

                const fieldName = right.getFieldSignature().getFieldName();
                const sourceFilePath = this.extractFilePathFromMethodSignature(methodSig);
                if (sourceFilePath.length === 0) continue;
                const sourceClassSig = right.getFieldSignature?.().getDeclaringSignature?.()?.toString?.()
                    || method.getDeclaringArkClass?.().getSignature?.().toString?.()
                    || ANY_CLASS_SIG;

                if (!out.has(fieldName)) out.set(fieldName, new Map<string, Map<string, Set<number>>>());
                const fileMap = out.get(fieldName)!;
                if (!fileMap.has(sourceFilePath)) fileMap.set(sourceFilePath, new Map<string, Set<number>>());
                const classMap = fileMap.get(sourceFilePath)!;
                if (!classMap.has(sourceClassSig)) classMap.set(sourceClassSig, new Set<number>());
                const outSet = classMap.get(sourceClassSig)!;
                for (const nodeId of leftNodes.values()) {
                    outSet.add(nodeId);
                }
            }
        }
        return out;
    }
}
