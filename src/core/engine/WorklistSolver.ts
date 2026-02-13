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
import { SyntheticInvokeEdgeInfo, SyntheticConstructorStoreInfo } from "./SyntheticInvokeEdgeBuilder";
import { WorklistProfiler } from "./WorklistProfiler";
import { PropagationTrace } from "./PropagationTrace";
import {
    collectPreciseArrayLoadNodeIdsFromTaintedLocal,
    collectContainerSlotLoadNodeIds,
    collectContainerSlotStoresFromTaintedLocal,
    fromContainerFieldKey,
    toContainerFieldKey
} from "./ContainerModel";

interface WorklistSolverDeps {
    scene: Scene;
    pag: Pag;
    tracker: TaintTracker;
    ctxManager: TaintContextManager;
    callEdgeMap: Map<string, CallEdgeInfo>;
    captureEdgeMap: Map<number, CaptureEdgeInfo[]>;
    syntheticInvokeEdgeMap: Map<number, SyntheticInvokeEdgeInfo[]>;
    syntheticConstructorStoreMap: Map<number, SyntheticConstructorStoreInfo[]>;
    fieldToVarIndex: Map<string, Set<number>>;
    profiler?: WorklistProfiler;
    propagationTrace?: PropagationTrace;
    log: (msg: string) => void;
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
            fieldToVarIndex,
            profiler,
            propagationTrace,
            log
        } = this.deps;
        const arraySlotObjsByCtx: Map<number, Set<number>> = new Map();
        profiler?.onQueueSize(worklist.length);

        while (worklist.length > 0) {
            const fact = worklist.shift()!;
            profiler?.onDequeue(worklist.length);
            propagationTrace?.recordFact(fact);
            const node = fact.node;
            const currentCtx = fact.contextID;

            const tryEnqueue = (
                reason: string,
                newFact: TaintFact,
                onAccepted: () => void
            ): void => {
                profiler?.onEnqueueAttempt(reason);
                if (visited.has(newFact.id)) {
                    profiler?.onDedupDrop(reason);
                    return;
                }
                visited.add(newFact.id);
                worklist.push(newFact);
                profiler?.onEnqueueSuccess(reason, worklist.length);
                propagationTrace?.recordEdge(fact, newFact, reason);
                onAccepted();
            };

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
                    tracker.markTainted(targetNodeId, currentCtx, fact.source);
                    log(`    [Expr] Tainted node ${targetNodeId} (ctx=${currentCtx})`);
                });
            }

            if (!fact.field || fact.field.length === 0) {
                const val = node.getValue();
                if (val instanceof Local) {
                    const preciseArrayLoads = collectPreciseArrayLoadNodeIdsFromTaintedLocal(val, pag);
                    for (const dstId of preciseArrayLoads) {
                        const dstNode = pag.getNode(dstId) as PagNode;
                        const newFact = new TaintFact(dstNode, fact.source, currentCtx);
                        tryEnqueue("Array-Precise", newFact, () => {
                            tracker.markTainted(dstId, currentCtx, fact.source);
                            log(`    [Array-Precise] Tainted var ${dstId} by precise array path (ctx=${currentCtx})`);
                        });
                    }

                    const slotStores = collectContainerSlotStoresFromTaintedLocal(val, pag);
                    for (const info of slotStores) {
                        const objNode = pag.getNode(info.objId) as PagNode;
                        const fieldKey = toContainerFieldKey(info.slot);
                        const newFact = new TaintFact(objNode, fact.source, currentCtx, [fieldKey]);
                        tryEnqueue("Container-Store", newFact, () => {
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
                        tracker.markTainted(captureEdge.dstNodeId, newCtx, fact.source);
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
                        tracker.markTainted(edge.dstNodeId, newCtx, fact.source);
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
                        log(`    [Synthetic-CtorStore] arg ${info.srcNodeId} -> Obj ${info.objId}.${info.fieldName} (ctx=${currentCtx})`);
                    });
                }
            }

            if (!fact.field || fact.field.length === 0) {
                const promiseCallbackFacts = this.propagatePromiseCallbackParams(scene, node, fact.source, currentCtx);
                for (const newFact of promiseCallbackFacts) {
                    tryEnqueue("Promise-CB", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source);
                        log(`    [Promise-CB] Tainted callback param node ${newFact.node.getID()} (ctx=${newFact.contextID})`);
                    });
                }
            }

            if (!fact.field || fact.field.length === 0) {
                const promiseArgFacts = this.propagatePromiseCallbacksFromTaintedArg(scene, node, fact.source, currentCtx);
                for (const newFact of promiseArgFacts) {
                    tryEnqueue("Promise-Arg", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source);
                        log(`    [Promise-Arg] Tainted callback param node ${newFact.node.getID()} (ctx=${newFact.contextID})`);
                    });
                }
            }

            if (!fact.field || fact.field.length === 0) {
                const restArgFacts = this.propagateRestArrayParam(scene, node, fact.source, currentCtx);
                for (const newFact of restArgFacts) {
                    tryEnqueue("Rest-Arg", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source);
                        log(`    [Rest-Arg] Tainted rest param node ${newFact.node.getID()} (ctx=${newFact.contextID})`);
                    });
                }
            }

            if (!fact.field || fact.field.length === 0) {
                const arrayLoadFacts = this.propagateArrayElementLoads(node, fact.source, currentCtx);
                for (const newFact of arrayLoadFacts) {
                    tryEnqueue("Array-Load", newFact, () => {
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source);
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
                        tracker.markTainted(targetNodeId, newCtx, fact.source);
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
                        tracker.markTainted(newFact.node.getID(), newFact.contextID, fact.source);
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
                            tracker.markTainted(loadNodeId, currentCtx, fact.source);
                            log(`    [Container-Load] Tainted var ${loadNodeId} from Obj ${objId}[${containerSlot}] (ctx=${currentCtx})`);
                        });
                    }
                }

                const key = `${objId}-${fieldName}`;
                const destVarIds = fieldToVarIndex.get(key);
                if (!destVarIds) continue;

                for (const destVarId of destVarIds) {
                    const dstNode = pag.getNode(destVarId) as PagNode;
                    if (!dstNode) continue;

                    const newFact = new TaintFact(dstNode, fact.source, currentCtx);
                    tryEnqueue("Load", newFact, () => {
                        tracker.markTainted(destVarId, currentCtx, fact.source);
                        log(`    [Load] Tainted var ${destVarId} from Obj ${objId}.${fieldName} (ctx=${currentCtx})`);
                    });
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
        const candidateNames = new Set<string>();

        if (callbackArg instanceof Local) {
            candidateNames.add(callbackArg.getName());
        }
        const txt = callbackArg?.toString?.() || "";
        if (txt) candidateNames.add(txt);

        for (const name of candidateNames) {
            const matched = scene.getMethods().filter(m => m.getName() === name);
            for (const m of matched) methods.push(m);
        }
        return methods;
    }
}
