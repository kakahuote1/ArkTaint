import { ArkArrayRef, ArkInstanceFieldRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { Pag, PagInstanceFieldNode, PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import { Constant } from "../../../arkanalyzer/out/src/core/base/Constant";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { ArkMethod } from "../../../arkanalyzer/out/src/core/model/ArkMethod";
import { ArkParameterRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../arkanalyzer/out/src/core/base/Expr";
import { TaintFact } from "./TaintFact";
import { TaintTracker } from "./TaintTracker";
import { TaintContextManager, CallEdgeInfo, CallEdgeType } from "./context/TaintContext";
import { propagateExpressionTaint } from "./ExpressionPropagation";
import { CaptureEdgeInfo } from "./CallEdgeMapBuilder";
import { SyntheticInvokeEdgeInfo, SyntheticConstructorStoreInfo, SyntheticFieldBridgeInfo } from "./SyntheticInvokeEdgeBuilder";
import { WorklistProfiler } from "./WorklistProfiler";
import { PropagationTrace } from "./PropagationTrace";
import { TransferRule } from "../rules/RuleSchema";
import { ConfigBasedTransferExecutor, TransferExecutionResult } from "./ConfigBasedTransferExecutor";
import type { SemanticPackQueryApi } from "./contracts/SemanticPack";
import { SemanticPackRuntime } from "./contracts/SemanticPack";
import type {
    BridgeDecl,
    EnqueueFactDecl,
    EnginePluginRuleChain,
    FlowDecl,
    PropagationContributionBatch,
    SyntheticEdgeDecl,
} from "./contracts/EnginePluginActions";
import { createEmptyPropagationContributionBatch } from "./contracts/EnginePluginActions";
import type {
    CallEdgeEvent,
    MethodReachedEvent,
    TaintFlowEvent,
} from "./contracts/EnginePluginEvents";
import { fromContainerFieldKey, toContainerFieldKey } from "./ContainerSlotKeys";
import { resolveMethodsFromCallable } from "../substrate/queries/CalleeResolver";

export interface WorklistSolverDeps {
    scene: Scene;
    pag: Pag;
    tracker: TaintTracker;
    ctxManager: TaintContextManager;
    callEdgeMap: Map<string, CallEdgeInfo>;
    captureEdgeMap: Map<number, CaptureEdgeInfo[]>;
    syntheticInvokeEdgeMap: Map<number, SyntheticInvokeEdgeInfo[]>;
    syntheticConstructorStoreMap: Map<number, SyntheticConstructorStoreInfo[]>;
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

const ANY_CLASS_SIG = "__ANY_CLASS__";
type ThisFieldFallbackLoadNodeIds = Map<string, Map<string, Map<string, Set<number>>>>;

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
            captureEdgeMap,
            syntheticInvokeEdgeMap,
            syntheticConstructorStoreMap,
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
        const unresolvedThisFieldLoadNodeIdsByFieldAndFile = this.buildUnresolvedThisFieldLoadNodeIdsByFieldAndFile(
            scene,
            pag,
            allowedMethodSignatures
        );
        const classBySignature = this.buildClassSignatureIndex(scene);
        const classRelationCache = new Map<string, boolean>();
        const objectNodeIdsByClassSignature = new Map<string, Set<number>>();
        for (const rawNode of pag.getNodesIter()) {
            const pagNode = rawNode as PagNode;
            const classSig = this.resolveObjectClassSignatureByNode(pagNode);
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
        profiler?.onQueueSize(worklist.length);
        const reachedMethodSignatures = new Set<string>();

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
                chainOverride?: FactRuleChain,
                allowUnreachableTarget: boolean = false,
            ): void => {
                if (
                    !allowUnreachableTarget
                    && !this.isNodeAllowedByReachability(newFact.node, allowedMethodSignatures)
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
                profiler?.onEnqueueSuccess(reason, worklist.length);
                propagationTrace?.recordEdge(fact, newFact, reason);
                const taintFlowBatch = onTaintFlow?.({
                    reason,
                    fromFact: fact,
                    toFact: newFact,
                }) || createEmptyPropagationContributionBatch();
                applyPluginPropagationBatch(taintFlowBatch, newFact, newChain, tryEnqueue);
                onAccepted();
            };

            const declaringMethodSignature = this.resolveDeclaringMethodSignature(node);
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
                const capturedFieldFacts = this.propagateCapturedFieldWrites(node, fact.source, currentCtx);
                for (const newFact of capturedFieldFacts) {
                    tryEnqueue("Capture-Store", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Capture-Store] Tainted field '${newFact.field?.[0]}' of Obj ${newFact.node.getID()} (ctx=${currentCtx})`);
                    });
                }
            }

            if (!fact.field || fact.field.length === 0) {
                const reflectSetFacts = this.propagateReflectSetFieldStores(node, fact.source, currentCtx);
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

            const shouldPropagatePromiseCallbacks = !fact.field
                || fact.field.length === 0
                || fromContainerFieldKey(fact.field[0]) !== null;
            if (shouldPropagatePromiseCallbacks) {
                const promiseCallbackFacts = this.propagatePromiseCallbackParams(scene, node, fact.source, currentCtx, fact.field);
                for (const newFact of promiseCallbackFacts) {
                    tryEnqueue("Promise-CB", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Promise-CB] Tainted callback param node ${newFact.node.getID()} (ctx=${newFact.contextID})`);
                    });
                }
            }

            if (shouldPropagatePromiseCallbacks) {
                const promiseArgFacts = this.propagatePromiseCallbacksFromTaintedArg(scene, node, fact.source, currentCtx, fact.field);
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

                const localStoreFallbackFacts = this.propagateLocalThisFieldStores(node, fact.source, currentCtx);
                for (const newFact of localStoreFallbackFacts) {
                    tryEnqueue("Store-LocalThisFieldFallback", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        const fieldName = newFact.field?.[0] || "<field>";
                        log(`    [Store-LocalThisFieldFallback] Tainted Obj ${newFact.node.getID()}.${fieldName} (ctx=${newFact.contextID})`);
                    });
                }
            }

            if (fact.field && fact.field.length > 0) {
                const localFieldFacts = this.propagateDirectFieldLoadsByLocal(node, fact.field, fact.source, currentCtx);
                for (const newFact of localFieldFacts) {
                    tryEnqueue("Load-LocalField", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Load-LocalField] Tainted node ${newFact.node.getID()} from local field '${fact.field?.[0]}' (ctx=${currentCtx})`);
                    });
                }
            }

            if (fact.field && fact.field.length > 0) {
                const reflectFacts = this.propagateReflectGetFieldLoadsByObj(node.getID(), fact.field, fact.source, currentCtx);
                for (const newFact of reflectFacts) {
                    tryEnqueue("Reflect-Load", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Reflect-Load] Tainted var ${newFact.node.getID()} from Reflect.get field '${fact.field[0]}' (ctx=${currentCtx})`);
                    });
                }
            }

            if (fact.field && fact.field.length > 0) {
                const directFieldFacts = this.propagateDirectFieldLoadsByObj(node.getID(), fact.field, fact.source, currentCtx);
                for (const newFact of directFieldFacts) {
                    tryEnqueue("Load-DirectField", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Load-DirectField] Tainted var ${newFact.node.getID()} from direct field '${fact.field?.[0]}' (ctx=${currentCtx})`);
                    });
                }
            }

            if (fact.field && fact.field.length > 0) {
                const directFieldArgFacts = this.propagateDirectFieldArgUsesByObj(node.getID(), fact.field, fact.source, currentCtx);
                for (const newFact of directFieldArgFacts) {
                    tryEnqueue("Load-DirectField-Arg", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Load-DirectField-Arg] Tainted node ${newFact.node.getID()} from direct field arg '${fact.field?.[0]}' (ctx=${currentCtx})`);
                    });
                }
            }

            if (fact.field && fact.field.length > 0) {
                const objectResultFacts = this.propagateObjectResultLoadsByObj(node.getID(), fact.field, fact.source, currentCtx);
                for (const newFact of objectResultFacts) {
                    tryEnqueue("Object-Result", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Object-Result] Tainted result node ${newFact.node.getID()} from Object.values/entries on field '${fact.field?.[0]}' (ctx=${currentCtx})`);
                    });
                }
            }

            if (fact.field && fact.field.length > 0) {
                const objectResultStoreFacts = this.propagateObjectResultContainerStoresByObj(node.getID(), fact.field, fact.source, currentCtx);
                for (const newFact of objectResultStoreFacts) {
                    tryEnqueue("Object-Result-Store", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source, newFact.field, newFact.id);
                        log(`    [Object-Result-Store] Tainted slot '${fromContainerFieldKey(newFact.field?.[0] || "") || newFact.field?.[0]}' of Obj ${newFact.node.getID()} via Object.values/entries (ctx=${currentCtx})`);
                    });
                }
            }

            if (fact.field && fact.field.length > 0) {
                const objectAssignFacts = this.propagateObjectAssignFieldBridgesByObj(node.getID(), fact.field, fact.source, currentCtx);
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
                if (containerSlot === null) {
                    const sourceClassSig = this.resolveObjectClassSignatureByNode(node);
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
                const destVarIds = fieldToVarIndex.get(key);
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
    }

    private resolveDeclaringMethodSignature(node: PagNode): string | undefined {
        const stmt: any = (node as any)?.stmt;
        const cfg = stmt?.getCfg?.();
        const method = cfg?.getDeclaringMethod?.();
        return method?.getSignature?.()?.toString?.();
    }

    private propagateReflectGetFieldLoadsByObj(
        taintedObjId: number,
        fieldPath: string[],
        source: string,
        currentCtx: number
    ): TaintFact[] {
        const { pag } = this.deps;
        const results: TaintFact[] = [];
        const fieldName = fieldPath[0];
        for (const rawNode of pag.getNodesIter()) {
            const aliasNode = rawNode as PagNode;

            const val = aliasNode.getValue();
            if (!(val instanceof Local)) continue;
            if (!this.aliasNodeMatchesCarrier(aliasNode, taintedObjId)) continue;

            for (const stmt of val.getUsedStmts()) {
                if (!(stmt instanceof ArkAssignStmt)) continue;
                const rightOp = stmt.getRightOp();
                if (!(rightOp instanceof ArkStaticInvokeExpr) && !(rightOp instanceof ArkInstanceInvokeExpr)) continue;

                const isReflectLikeGet = this.isReflectLikeCall(rightOp, "get");
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
                    if (fieldPath.length > 1) {
                        const dstPts = dstNode.getPointTo();
                        let hasPointTo = false;
                        for (const objId of dstPts) {
                            hasPointTo = true;
                            const objNode = pag.getNode(objId) as PagNode;
                            results.push(new TaintFact(objNode, source, currentCtx, fieldPath.slice(1)));
                        }
                        if (!hasPointTo) {
                            results.push(new TaintFact(dstNode, source, currentCtx, fieldPath.slice(1)));
                        }
                    } else {
                        results.push(new TaintFact(dstNode, source, currentCtx));
                    }
                }
            }
        }

        return results;
    }

    private propagateDirectFieldLoadsByLocal(
        taintedNode: PagNode,
        fieldPath: string[],
        source: string,
        currentCtx: number
    ): TaintFact[] {
        const { pag } = this.deps;
        const results: TaintFact[] = [];
        const fieldName = fieldPath[0];
        const val = taintedNode.getValue();
        if (!(val instanceof Local)) return results;

        for (const stmt of val.getUsedStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const rightOp = stmt.getRightOp();
            if (!(rightOp instanceof ArkInstanceFieldRef)) continue;
            if (rightOp.getBase() !== val) continue;
            if (rightOp.getFieldSignature().getFieldName() !== fieldName) continue;

            const dstNodes = pag.getNodesByValue(stmt.getLeftOp());
            const loadNodes = dstNodes && dstNodes.size > 0
                ? dstNodes
                : this.getOrCreatePagNodes(stmt.getLeftOp(), stmt);
            if (!loadNodes) continue;
            for (const dstNodeId of loadNodes.values()) {
                const dstNode = pag.getNode(dstNodeId) as PagNode;
                if (fieldPath.length > 1) {
                    const dstPts = dstNode.getPointTo();
                    let hasPointTo = false;
                    for (const objId of dstPts) {
                        hasPointTo = true;
                        const objNode = pag.getNode(objId) as PagNode;
                        results.push(new TaintFact(objNode, source, currentCtx, fieldPath.slice(1)));
                    }
                    if (!hasPointTo) {
                        results.push(new TaintFact(dstNode, source, currentCtx, fieldPath.slice(1)));
                    }
                } else {
                    results.push(new TaintFact(dstNode, source, currentCtx));
                }
            }
        }

        return results;
    }

    private propagateObjectResultLoadsByObj(
        taintedObjId: number,
        fieldPath: string[],
        source: string,
        currentCtx: number
    ): TaintFact[] {
        const { pag } = this.deps;
        const results: TaintFact[] = [];
        for (const rawNode of pag.getNodesIter()) {
            const aliasNode = rawNode as PagNode;
            const val = aliasNode.getValue();
            if (!(val instanceof Local)) continue;
            if (!this.aliasNodeMatchesCarrier(aliasNode, taintedObjId)) continue;

            for (const stmt of val.getUsedStmts()) {
                if (!(stmt instanceof ArkAssignStmt)) continue;
                const rightOp = stmt.getRightOp();
                if (!(rightOp instanceof ArkStaticInvokeExpr)) continue;
                if (!this.isObjectBuiltinCall(rightOp, "values") && !this.isObjectBuiltinCall(rightOp, "entries")) continue;

                const args = rightOp.getArgs ? rightOp.getArgs() : [];
                if (args.length < 1 || args[0] !== val) continue;

                const dstNodes = pag.getNodesByValue(stmt.getLeftOp());
                const loadNodes = dstNodes && dstNodes.size > 0
                    ? dstNodes
                    : this.getOrCreatePagNodes(stmt.getLeftOp(), stmt);
                if (!loadNodes) continue;
                for (const dstNodeId of loadNodes.values()) {
                    const dstNode = pag.getNode(dstNodeId) as PagNode;
                    results.push(new TaintFact(dstNode, source, currentCtx));
                }
            }
        }
        return results;
    }

    private propagateObjectResultContainerStoresByObj(
        taintedObjId: number,
        fieldPath: string[],
        source: string,
        currentCtx: number
    ): TaintFact[] {
        const { pag } = this.deps;
        const results: TaintFact[] = [];
        const dedup = new Set<number>();

        for (const rawNode of pag.getNodesIter()) {
            const aliasNode = rawNode as PagNode;
            const val = aliasNode.getValue();
            if (!(val instanceof Local)) continue;
            if (!this.aliasNodeMatchesCarrier(aliasNode, taintedObjId)) continue;

            for (const stmt of val.getUsedStmts()) {
                if (!(stmt instanceof ArkAssignStmt)) continue;
                const rightOp = stmt.getRightOp();
                if (!(rightOp instanceof ArkStaticInvokeExpr)) continue;
                if (!this.isObjectBuiltinCall(rightOp, "values") && !this.isObjectBuiltinCall(rightOp, "entries")) continue;

                const args = rightOp.getArgs ? rightOp.getArgs() : [];
                if (args.length < 1 || args[0] !== val) continue;

                const resultNodes = this.getOrCreatePagNodes(stmt.getLeftOp(), stmt);
                if (!resultNodes) continue;
                for (const resultNodeId of resultNodes.values()) {
                    if (dedup.has(resultNodeId)) continue;
                    dedup.add(resultNodeId);
                    const resultNode = pag.getNode(resultNodeId) as PagNode;
                    results.push(new TaintFact(resultNode, source, currentCtx, [toContainerFieldKey("arr:*")]));
                }
            }
        }

        return results;
    }

    private propagateObjectAssignFieldBridgesByObj(
        taintedObjId: number,
        fieldPath: string[],
        source: string,
        currentCtx: number
    ): TaintFact[] {
        const { pag } = this.deps;
        const results: TaintFact[] = [];
        for (const rawNode of pag.getNodesIter()) {
            const aliasNode = rawNode as PagNode;
            const val = aliasNode.getValue();
            if (!(val instanceof Local)) continue;
            if (!this.aliasNodeMatchesCarrier(aliasNode, taintedObjId)) continue;

            for (const stmt of val.getUsedStmts()) {
                const invokeExpr = stmt.containsInvokeExpr && stmt.containsInvokeExpr() ? stmt.getInvokeExpr() : undefined;
                if (!(invokeExpr instanceof ArkStaticInvokeExpr)) continue;
                if (!this.isObjectBuiltinCall(invokeExpr, "assign")) continue;

                const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
                if (args.length < 2) continue;
                if (!args.slice(1).includes(val)) continue;

                const targetNodes = pag.getNodesByValue(args[0]);
                if (!targetNodes) continue;
                for (const targetNodeId of targetNodes.values()) {
                    const targetNode = pag.getNode(targetNodeId) as PagNode;
                    for (const objId of targetNode.getPointTo()) {
                        const objNode = pag.getNode(objId) as PagNode;
                        results.push(new TaintFact(objNode, source, currentCtx, [...fieldPath]));
                    }
                }

                if (stmt instanceof ArkAssignStmt) {
                    const assignResult = stmt.getLeftOp();
                    if (assignResult instanceof Local) {
                        for (const useStmt of assignResult.getUsedStmts()) {
                            if (!(useStmt instanceof ArkAssignStmt)) continue;
                            const rightOp = useStmt.getRightOp();
                            if (!(rightOp instanceof ArkInstanceFieldRef)) continue;
                            if (rightOp.getBase() !== assignResult) continue;
                            if (rightOp.getFieldSignature().getFieldName() !== fieldPath[0]) continue;

                            const dstNodes = pag.getNodesByValue(useStmt.getLeftOp());
                            const loadNodes = dstNodes && dstNodes.size > 0
                                ? dstNodes
                                : this.getOrCreatePagNodes(useStmt.getLeftOp(), useStmt);
                            if (!loadNodes) continue;
                            for (const dstNodeId of loadNodes.values()) {
                                const dstNode = pag.getNode(dstNodeId) as PagNode;
                                results.push(new TaintFact(dstNode, source, currentCtx));
                            }
                        }
                    }
                }
            }
        }
        return results;
    }

    private propagateReflectSetFieldStores(
        taintedNode: PagNode,
        source: string,
        currentCtx: number
    ): TaintFact[] {
        const { pag } = this.deps;
        const results: TaintFact[] = [];
        const val = taintedNode.getValue();
        if (!(val instanceof Local)) return results;

        for (const stmt of val.getUsedStmts()) {
            if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!(invokeExpr instanceof ArkStaticInvokeExpr) && !(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;

            if (!this.isReflectLikeCall(invokeExpr, "set")) continue;

            const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            if (args.length < 3) continue;
            if (args[2] !== val) continue;

            const fieldName = this.resolveReflectPropertyName(args[1]);
            if (!fieldName) continue;

            const baseNodes = pag.getNodesByValue(args[0]);
            if (!baseNodes) continue;
            for (const baseNodeId of baseNodes.values()) {
                const baseNode = pag.getNode(baseNodeId) as PagNode;
                for (const objId of baseNode.getPointTo()) {
                    const objNode = pag.getNode(objId) as PagNode;
                    results.push(new TaintFact(objNode, source, currentCtx, [fieldName]));
                }
            }
        }

        return results;
    }

    private propagateDirectFieldLoadsByObj(
        taintedObjId: number,
        fieldPath: string[],
        source: string,
        currentCtx: number
    ): TaintFact[] {
        const { pag } = this.deps;
        const results: TaintFact[] = [];
        const fieldName = fieldPath[0];
        for (const rawNode of pag.getNodesIter()) {
            const aliasNode = rawNode as PagNode;
            const val = aliasNode.getValue();
            if (!(val instanceof Local)) continue;
            if (!this.aliasNodeMatchesCarrier(aliasNode, taintedObjId)) continue;

            for (const stmt of val.getUsedStmts()) {
                if (!(stmt instanceof ArkAssignStmt)) continue;
                const rightOp = stmt.getRightOp();
                if (!(rightOp instanceof ArkInstanceFieldRef)) continue;
                if (rightOp.getBase() !== val) continue;
                if (rightOp.getFieldSignature().getFieldName() !== fieldName) continue;

                const dstNodes = pag.getNodesByValue(stmt.getLeftOp());
                const loadNodes = dstNodes && dstNodes.size > 0
                    ? dstNodes
                    : this.getOrCreatePagNodes(stmt.getLeftOp(), stmt);
                if (!loadNodes) continue;
                for (const dstNodeId of loadNodes.values()) {
                    const dstNode = pag.getNode(dstNodeId) as PagNode;
                    if (fieldPath.length > 1) {
                        const dstPts = dstNode.getPointTo();
                        let hasPointTo = false;
                        for (const objId of dstPts) {
                            hasPointTo = true;
                            const objNode = pag.getNode(objId) as PagNode;
                            results.push(new TaintFact(objNode, source, currentCtx, fieldPath.slice(1)));
                        }
                        if (!hasPointTo) {
                            results.push(new TaintFact(dstNode, source, currentCtx, fieldPath.slice(1)));
                        }
                    } else {
                        results.push(new TaintFact(dstNode, source, currentCtx));
                    }
                }
            }
        }
        return results;
    }

    private propagateDirectFieldArgUsesByObj(
        taintedObjId: number,
        fieldPath: string[],
        source: string,
        currentCtx: number
    ): TaintFact[] {
        const { pag } = this.deps;
        const results: TaintFact[] = [];
        const fieldName = fieldPath[0];
        for (const rawNode of pag.getNodesIter()) {
            const aliasNode = rawNode as PagNode;
            const val = aliasNode.getValue();
            if (!(val instanceof Local)) continue;
            if (!this.aliasNodeMatchesCarrier(aliasNode, taintedObjId)) continue;

            for (const stmt of val.getUsedStmts()) {
                if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
                const invokeExpr = stmt.getInvokeExpr();
                if (!(invokeExpr instanceof ArkStaticInvokeExpr) && !(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
                const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
                for (const arg of args) {
                    if (!(arg instanceof ArkInstanceFieldRef)) continue;
                    if (arg.getBase() !== val) continue;
                    if (arg.getFieldSignature().getFieldName() !== fieldName) continue;

                    const argNodes = this.getOrCreatePagNodes(arg, stmt);
                    if (!argNodes) continue;
                    for (const argNodeId of argNodes.values()) {
                        const argNode = pag.getNode(argNodeId) as PagNode;
                        if (fieldPath.length > 1) {
                            const argPts = argNode.getPointTo();
                            let hasPointTo = false;
                            for (const objId of argPts) {
                                hasPointTo = true;
                                const objNode = pag.getNode(objId) as PagNode;
                                results.push(new TaintFact(objNode, source, currentCtx, fieldPath.slice(1)));
                            }
                            if (!hasPointTo) {
                                results.push(new TaintFact(argNode, source, currentCtx, fieldPath.slice(1)));
                            }
                        } else {
                            results.push(new TaintFact(argNode, source, currentCtx));
                        }
                    }
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

    private resolveReflectPropertyName(value: any): string | undefined {
        if (value instanceof Constant) {
            return this.normalizeReflectPropertyLiteral(value.toString());
        }
        if (value instanceof Local) {
            const decl = value.getDeclaringStmt();
            if (decl instanceof ArkAssignStmt && decl.getLeftOp() === value) {
                const right = decl.getRightOp();
                if (right instanceof Constant) {
                    return this.normalizeReflectPropertyLiteral(right.toString());
                }
            }
            const text = value.getName?.() || value.toString?.() || "";
            return text ? this.normalizeReflectPropertyLiteral(text) : undefined;
        }
        const text = value?.toString?.() || "";
        return text ? this.normalizeReflectPropertyLiteral(text) : undefined;
    }

    private normalizeReflectPropertyLiteral(text: string): string {
        return text.replace(/^['"`]/, "").replace(/['"`]$/, "");
    }

    private getOrCreatePagNodes(value: any, anchorStmt: any): Map<number, number> | undefined {
        const { pag } = this.deps;
        let nodes = pag.getNodesByValue(value);
        if (nodes && nodes.size > 0) {
            return nodes;
        }
        pag.addPagNode(0, value, anchorStmt);
        nodes = pag.getNodesByValue(value);
        return nodes;
    }

    private aliasNodeMatchesCarrier(aliasNode: PagNode, taintedObjId: number): boolean {
        if (aliasNode.getID() === taintedObjId) return true;
        const pts = aliasNode.getPointTo();
        return !!(pts && pts.contains(taintedObjId));
    }

    private isReflectLikeCall(
        invokeExpr: ArkStaticInvokeExpr | ArkInstanceInvokeExpr,
        methodName: "get" | "set"
    ): boolean {
        const sig = invokeExpr.getMethodSignature()?.toString() || "";
        if (sig.includes(`Reflect.${methodName}`)) return true;
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) return false;
        const baseText = invokeExpr.getBase()?.toString?.() || "";
        return baseText === "Reflect" && sig.includes(`.${methodName}()`);
    }

    private isObjectBuiltinCall(
        invokeExpr: ArkStaticInvokeExpr | ArkInstanceInvokeExpr,
        methodName: "assign" | "values" | "entries"
    ): boolean {
        if (!(invokeExpr instanceof ArkStaticInvokeExpr)) return false;
        const sig = invokeExpr.getMethodSignature()?.toString() || "";
        return sig.includes(`Object.${methodName}`);
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
            if (baseNodesMap) {
                for (const baseNodeId of baseNodesMap.values()) {
                    const baseNode = pag.getNode(baseNodeId) as PagNode;
                    let hasPointTo = false;
                    for (const objId of baseNode.getPointTo()) {
                        hasPointTo = true;
                        const objNode = pag.getNode(objId) as PagNode;
                        results.push(new TaintFact(objNode, source, currentCtx, [fieldName]));
                    }
                    if (!hasPointTo) {
                        results.push(new TaintFact(baseNode, source, currentCtx, [fieldName]));
                    }
                }
            }

            const declaringStmt = baseLocal.getDeclaringStmt?.();
            if (!(declaringStmt instanceof ArkAssignStmt)) continue;
            const baseRightOp = declaringStmt.getRightOp();
            if (!(baseRightOp instanceof ArkInstanceFieldRef)) continue;

            const ownerFieldName = baseRightOp.getFieldSignature().getFieldName();
            const ownerBaseNodesMap = pag.getNodesByValue(baseRightOp.getBase());
            if (!ownerBaseNodesMap) continue;
            for (const ownerBaseNodeId of ownerBaseNodesMap.values()) {
                const ownerBaseNode = pag.getNode(ownerBaseNodeId) as PagNode;
                for (const ownerObjId of ownerBaseNode.getPointTo()) {
                    const ownerObjNode = pag.getNode(ownerObjId) as PagNode;
                    results.push(new TaintFact(ownerObjNode, source, currentCtx, [ownerFieldName, fieldName]));
                }
            }
        }
        return results;
    }

    private propagatePromiseCallbackParams(
        scene: Scene,
        taintedNode: PagNode,
        source: string,
        currentCtx: number,
        fieldPath?: string[]
    ): TaintFact[] {
        const { pag } = this.deps;
        const results: TaintFact[] = [];
        const val = taintedNode.getValue();
        if (!(val instanceof Local)) return results;

        results.push(...this.collectPromiseCallbackFactsByReceiverLocal(scene, val, source, currentCtx, fieldPath));

        return results;
    }

    private propagatePromiseCallbacksFromTaintedArg(
        scene: Scene,
        taintedNode: PagNode,
        source: string,
        currentCtx: number,
        fieldPath?: string[]
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

            results.push(...this.collectPromiseCallbackFactsByReceiverLocal(scene, leftOp, source, currentCtx, fieldPath));
        }

        return results;
    }

    private collectPromiseCallbackFactsByReceiverLocal(
        scene: Scene,
        receiverLocal: Local,
        source: string,
        currentCtx: number,
        fieldPath?: string[]
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
                    const nodes = this.getOrCreatePagNodes(leftOp, pStmt);
                    if (!nodes) continue;
                    for (const nid of nodes.values()) {
                        const n = pag.getNode(nid) as PagNode;
                        results.push(new TaintFact(n, source, currentCtx, fieldPath ? [...fieldPath] : undefined));
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
                                results.push(new TaintFact(n, source, currentCtx, fieldPath ? [...fieldPath] : undefined));
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
                        results.push(new TaintFact(n, source, currentCtx, fieldPath ? [...fieldPath] : undefined));
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
            const watchTargetField = this.resolveWatchLikeTargetField(method);

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
                if (watchTargetField !== undefined && watchTargetField.length > 0 && watchTargetField !== fieldName) {
                    continue;
                }
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

    private resolveWatchLikeTargetField(method: ArkMethod): string | undefined {
        const decorators = method.getDecorators?.() || [];
        for (const decorator of decorators) {
            const kind = String(decorator?.getKind?.() || "").replace(/^@+/, "").trim();
            if (kind !== "Watch" && kind !== "Monitor") continue;
            const fromParam = this.normalizeDecoratorFieldToken(decorator?.getParam?.());
            if (fromParam !== undefined) return fromParam;
            const fromContent = this.extractDecoratorFieldTokenFromContent(decorator?.getContent?.());
            if (fromContent !== undefined) return fromContent;
            return "";
        }
        return undefined;
    }

    private normalizeDecoratorFieldToken(raw: any): string | undefined {
        if (raw === undefined || raw === null) return undefined;
        const text = String(raw).trim();
        if (!text) return "";
        return text.replace(/^['"`]/, "").replace(/['"`]$/, "").trim();
    }

    private extractDecoratorFieldTokenFromContent(content: any): string | undefined {
        const text = String(content || "");
        if (!text) return undefined;
        const m = text.match(/\(\s*['"`]([^'"`]+)['"`]\s*\)/);
        if (!m) return undefined;
        return this.normalizeDecoratorFieldToken(m[1]);
    }

    private propagateLocalThisFieldStores(
        taintedNode: PagNode,
        source: string,
        currentCtx: number
    ): TaintFact[] {
        const { pag } = this.deps;
        const out: TaintFact[] = [];
        const seen = new Set<string>();
        const add = (fact: TaintFact): void => {
            if (seen.has(fact.id)) return;
            seen.add(fact.id);
            out.push(fact);
        };

        const value = taintedNode.getValue?.();
        if (!(value instanceof Local)) return out;

        const candidateStmts: any[] = [];
        const seenStmt = new Set<string>();
        const addStmt = (stmt: any): void => {
            if (!stmt) return;
            const key = stmt.toString?.() || `${candidateStmts.length}`;
            if (seenStmt.has(key)) return;
            seenStmt.add(key);
            candidateStmts.push(stmt);
        };
        for (const stmt of value.getUsedStmts()) {
            addStmt(stmt);
        }
        const declStmt = value.getDeclaringStmt?.();
        const declCfg = declStmt?.getCfg?.();
        if (declCfg) {
            for (const stmt of declCfg.getStmts()) {
                addStmt(stmt);
            }
        }
        const nodeStmt = taintedNode.getStmt?.();
        const nodeCfg = nodeStmt?.getCfg?.();
        if (nodeCfg) {
            for (const stmt of nodeCfg.getStmts()) {
                addStmt(stmt);
            }
        }

        for (const stmt of candidateStmts) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            const right = stmt.getRightOp();
            if (!(left instanceof ArkInstanceFieldRef) || !(right instanceof Local)) continue;
            if (right !== value && right.getName?.() !== value.getName?.()) continue;
            const base = left.getBase?.();
            if (!(base instanceof Local) || base.getName?.() !== "this") continue;

            const fieldName = left.getFieldSignature?.().getFieldName?.() || left.getFieldName?.();
            if (!fieldName) continue;
            let baseNodes = pag.getNodesByValue(base);
            if ((!baseNodes || baseNodes.size === 0) && base instanceof Local) {
                try {
                    pag.addPagNode(0, base, stmt);
                    baseNodes = pag.getNodesByValue(base);
                } catch {
                    baseNodes = undefined;
                }
            }
            if (!baseNodes || baseNodes.size === 0) continue;

            for (const baseNodeId of baseNodes.values()) {
                const baseNode = pag.getNode(baseNodeId) as PagNode;
                if (!baseNode) continue;
                let hasPointTo = false;
                for (const objId of baseNode.getPointTo()) {
                    hasPointTo = true;
                    const objNode = pag.getNode(objId) as PagNode;
                    if (!objNode) continue;
                    add(new TaintFact(objNode, source, currentCtx, [fieldName]));
                }
                if (!hasPointTo) {
                    add(new TaintFact(baseNode, source, currentCtx, [fieldName]));
                }
            }
        }
        return out;
    }

}
