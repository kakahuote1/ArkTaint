import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { CallGraph } from "../../../arkanalyzer/out/src/callgraph/model/CallGraph";
import { Pag, PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt, ArkReturnStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import { CallEdgeInfo, CallEdgeType } from "../context/TaintContext";
import {
    collectParameterAssignStmts,
    isReflectDispatchInvoke,
    mapInvokeArgsToParamAssigns,
    resolveCalleeCandidates
} from "./CalleeResolver";

export interface CaptureEdgeInfo {
    srcNodeId: number;
    dstNodeId: number;
    callSiteId: number;
    callerMethodName: string;
    calleeMethodName: string;
}

export function buildCallEdgeMap(
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    log: (msg: string) => void
): Map<string, CallEdgeInfo> {
    const callEdgeMap = new Map<string, CallEdgeInfo>();
    log("Building Call Edge Map...");

    let callEdgesFound = 0;
    let returnEdgesFound = 0;

    for (const method of scene.getMethods()) {
        const cfg = method.getCfg();
        if (!cfg) continue;

        for (const stmt of cfg.getStmts()) {
            if (!stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!invokeExpr) continue;
            const invokeSig = invokeExpr.getMethodSignature()?.toString() || "";
            if (invokeSig.includes("%unk")) continue;
            const callSites = cg.getCallSiteByStmt(stmt);
            if (!callSites || callSites.length === 0) continue;

            for (const cs of callSites) {
                const calleeFuncID = cs.getCalleeFuncID();
                if (!calleeFuncID) continue;

                const calleeMethod = cg.getArkMethodByFuncID(calleeFuncID);
                if (!calleeMethod || !calleeMethod.getCfg()) continue;

                const callerName = method.getName();
                const calleeName = calleeMethod.getName();
                const stableCallSiteId = stmt.getOriginPositionInfo().getLineNo() * 10000 + calleeFuncID;
                const explicitArgs = cs.args || [];
                const paramStmts = collectParameterAssignStmts(calleeMethod);
                const pairs = mapInvokeArgsToParamAssigns(invokeExpr, explicitArgs, paramStmts);

                for (const pair of pairs) {
                    const arg = pair.arg;
                    const param = pair.paramStmt.getRightOp();
                    const srcNodes = pag.getNodesByValue(arg);
                    const dstNodes = pag.getNodesByValue(param);
                    if (!srcNodes || !dstNodes) continue;

                    for (const srcId of srcNodes.values()) {
                        for (const dstId of dstNodes.values()) {
                            const srcNode = pag.getNode(srcId) as PagNode;
                            const copyEdges = srcNode.getOutgoingCopyEdges()?.values();
                            if (!copyEdges) continue;

                            for (const edge of copyEdges) {
                                if (edge.getDstID() !== dstId) continue;
                                const edgeKey = `${srcId}->${dstId}`;
                                callEdgeMap.set(edgeKey, {
                                    type: CallEdgeType.CALL,
                                    callSiteId: stableCallSiteId,
                                    callerMethodName: callerName,
                                    calleeMethodName: calleeName,
                                });
                                callEdgesFound++;
                            }
                        }
                    }
                }

                if (!(stmt instanceof ArkAssignStmt)) continue;

                const retDst = stmt.getLeftOp();
                const retStmts = calleeMethod.getReturnStmt();
                for (const retStmt of retStmts) {
                    const retValue = (retStmt as ArkReturnStmt).getOp();
                    if (!(retValue instanceof Local)) continue;

                    const srcNodes = pag.getNodesByValue(retValue);
                    const dstNodes = pag.getNodesByValue(retDst);
                    if (!srcNodes || !dstNodes) continue;

                    for (const srcId of srcNodes.values()) {
                        for (const dstId of dstNodes.values()) {
                            const srcNode = pag.getNode(srcId) as PagNode;
                            const copyEdges = srcNode.getOutgoingCopyEdges()?.values();
                            if (!copyEdges) continue;

                            for (const edge of copyEdges) {
                                if (edge.getDstID() !== dstId) continue;
                                const edgeKey = `${srcId}->${dstId}`;
                                callEdgeMap.set(edgeKey, {
                                    type: CallEdgeType.RETURN,
                                    callSiteId: stableCallSiteId,
                                    callerMethodName: callerName,
                                    calleeMethodName: calleeName,
                                });
                                returnEdgesFound++;
                            }
                        }
                    }
                }
            }
        }
    }

    log(`Call Edge Map Built: ${callEdgesFound} call edges, ${returnEdgesFound} return edges.`);
    return callEdgeMap;
}

export function buildCaptureEdgeMap(
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    log: (msg: string) => void
): Map<number, CaptureEdgeInfo[]> {
    const captureEdgeMap = new Map<number, CaptureEdgeInfo[]>();
    let captureEdgesFound = 0;

    for (const method of scene.getMethods()) {
        const cfg = method.getCfg();
        const body = method.getBody();
        if (!cfg || !body) continue;

        const callerLocalsByName = new Map<string, Local[]>();
        for (const local of body.getLocals().values()) {
            if (!callerLocalsByName.has(local.getName())) callerLocalsByName.set(local.getName(), []);
            callerLocalsByName.get(local.getName())!.push(local);
        }

        for (const stmt of cfg.getStmts()) {
            if (!stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!invokeExpr) continue;

            const callSites = cg.getCallSiteByStmt(stmt) || [];
            const calleeMethods: { method: any; callSiteId: number; argCount: number }[] = [];

            for (const cs of callSites) {
                const calleeFuncID = cs.getCalleeFuncID();
                if (!calleeFuncID) continue;
                const calleeMethod = cg.getArkMethodByFuncID(calleeFuncID);
                if (!calleeMethod) continue;

                const argCount = invokeExpr.getArgs ? invokeExpr.getArgs().length : (cs.args ? cs.args.length : 0);
                const callSiteId = stmt.getOriginPositionInfo().getLineNo() * 10000 + calleeFuncID;
                calleeMethods.push({ method: calleeMethod, callSiteId, argCount });
            }

            if (calleeMethods.length === 0 || isReflectDispatchInvoke(invokeExpr)) {
                const fallbackCallees = resolveCalleeCandidates(scene, invokeExpr);
                const argCount = invokeExpr.getArgs ? invokeExpr.getArgs().length : 0;
                for (const resolved of fallbackCallees) {
                    const targetSig = resolved.method.getSignature().toString();
                    const callSiteId = stmt.getOriginPositionInfo().getLineNo() * 10000 + thisSimpleHash(targetSig);
                    calleeMethods.push({ method: resolved.method, callSiteId, argCount });
                }
            }

            for (const calleeInfo of calleeMethods) {
                if (calleeInfo.argCount > 0) continue;

                const calleeMethod = calleeInfo.method;
                if (!calleeMethod || !calleeMethod.getCfg()) continue;

                const callerName = method.getName();
                const calleeName = calleeMethod.getName();
                const callSiteId = calleeInfo.callSiteId;
                const captureTargets = collectNoArgCalleeClosure(scene, calleeMethod);

                for (const targetMethod of captureTargets) {
                    const targetCfg = targetMethod.getCfg();
                    if (!targetCfg) continue;

                    for (const calleeStmt of targetCfg.getStmts()) {
                        if (!(calleeStmt instanceof ArkAssignStmt)) continue;
                        const rightOp = calleeStmt.getRightOp();
                        if (!(rightOp instanceof Local)) continue;

                        const sameNameCallerLocals = callerLocalsByName.get(rightOp.getName());
                        if (!sameNameCallerLocals || sameNameCallerLocals.length === 0) continue;

                        const dstNodes = pag.getNodesByValue(rightOp);
                        if (!dstNodes || dstNodes.size === 0) continue;

                        for (const callerLocal of sameNameCallerLocals) {
                            const srcNodes = pag.getNodesByValue(callerLocal);
                            if (!srcNodes || srcNodes.size === 0) continue;

                            for (const srcNodeId of srcNodes.values()) {
                                for (const dstNodeId of dstNodes.values()) {
                                    if (!captureEdgeMap.has(srcNodeId)) {
                                        captureEdgeMap.set(srcNodeId, []);
                                    }
                                    captureEdgeMap.get(srcNodeId)!.push({
                                        srcNodeId,
                                        dstNodeId,
                                        callSiteId,
                                        callerMethodName: callerName,
                                        calleeMethodName: calleeName,
                                    });
                                    captureEdgesFound++;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    log(`Capture Edge Map Built: ${captureEdgesFound} synthetic capture edges.`);
    return captureEdgeMap;
}

function collectNoArgCalleeClosure(scene: Scene, startMethod: any): any[] {
    const results: any[] = [];
    const queue: any[] = [startMethod];
    const visited = new Set<string>();

    while (queue.length > 0) {
        const method = queue.shift();
        if (!method || !method.getCfg) continue;

        const sig = method.getSignature().toString();
        if (visited.has(sig)) continue;
        visited.add(sig);
        results.push(method);

        const cfg = method.getCfg();
        if (!cfg) continue;

        for (const stmt of cfg.getStmts()) {
            if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!invokeExpr) continue;

            const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            if (args.length > 0) continue;

            const calleeSig = invokeExpr.getMethodSignature().toString();
            if (!calleeSig || calleeSig.includes("%unk")) continue;
            const callee = scene.getMethods().find(m => m.getSignature().toString() === calleeSig);
            if (callee) queue.push(callee);
        }
    }

    return results;
}

function thisSimpleHash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h) + s.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h % 10000);
}
