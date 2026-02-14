import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { CallGraph } from "../../../arkanalyzer/out/src/callgraph/model/CallGraph";
import { Pag, PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt, ArkReturnStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkParameterRef, ArkInstanceFieldRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import { ArkInstanceInvokeExpr } from "../../../arkanalyzer/out/src/core/base/Expr";
import { CallEdgeType } from "../context/TaintContext";
import {
    collectParameterAssignStmts,
    mapInvokeArgsToParamAssigns,
    resolveCalleeCandidates
} from "./CalleeResolver";

export interface SyntheticInvokeEdgeInfo {
    type: CallEdgeType;
    srcNodeId: number;
    dstNodeId: number;
    callSiteId: number;
    callerMethodName: string;
    calleeMethodName: string;
}

export interface SyntheticConstructorStoreInfo {
    srcNodeId: number;
    objId: number;
    fieldName: string;
}

export function buildSyntheticInvokeEdges(
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    log: (msg: string) => void
): Map<number, SyntheticInvokeEdgeInfo[]> {
    const edgeMap = new Map<number, SyntheticInvokeEdgeInfo[]>();
    let syntheticCallCount = 0;
    let syntheticReturnCount = 0;
    let nameFallbackCalleeCount = 0;

    for (const caller of scene.getMethods()) {
        const cfg = caller.getCfg();
        if (!cfg) continue;

        for (const stmt of cfg.getStmts()) {
            if (!stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!invokeExpr) continue;

            const callSites = cg.getCallSiteByStmt(stmt) || [];
            if (callSites.length > 0) continue;

            const callees = resolveCalleeCandidates(scene, invokeExpr);
            if (callees.length === 0) continue;

            for (const resolved of callees) {
                const callee = resolved.method;
                if (!callee || !callee.getCfg()) continue;
                if (resolved.reason === "name_fallback") {
                    nameFallbackCalleeCount++;
                }

                const calleeSig = callee.getSignature().toString();
                const callSiteId = stmt.getOriginPositionInfo().getLineNo() * 10000 + simpleHash(calleeSig);
                const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
                const paramStmts = collectParameterAssignStmts(callee);
                const pairs = mapInvokeArgsToParamAssigns(invokeExpr, explicitArgs, paramStmts);

                for (const pair of pairs) {
                    const arg = pair.arg;
                    const paramStmt = pair.paramStmt;
                    const srcNodes = pag.getNodesByValue(arg);

                    let dstNodes = pag.getNodesByValue(paramStmt.getLeftOp());
                    if (!dstNodes || dstNodes.size === 0) {
                        dstNodes = pag.getNodesByValue(paramStmt.getRightOp());
                    }
                    if (!srcNodes || !dstNodes) continue;

                    for (const srcNodeId of srcNodes.values()) {
                        for (const dstNodeId of dstNodes.values()) {
                            pushEdge(edgeMap, srcNodeId, {
                                type: CallEdgeType.CALL,
                                srcNodeId,
                                dstNodeId,
                                callSiteId,
                                callerMethodName: caller.getName(),
                                calleeMethodName: callee.getName(),
                            });
                            syntheticCallCount++;
                        }
                    }
                }

                if (!(stmt instanceof ArkAssignStmt)) continue;

                const retDst = stmt.getLeftOp();
                const retStmts = callee.getReturnStmt();
                for (const retStmt of retStmts) {
                    const retValue = (retStmt as ArkReturnStmt).getOp();
                    if (!(retValue instanceof Local)) continue;

                    const srcNodes = pag.getNodesByValue(retValue);
                    const dstNodes = pag.getNodesByValue(retDst);
                    if (!srcNodes || !dstNodes) continue;

                    for (const srcNodeId of srcNodes.values()) {
                        for (const dstNodeId of dstNodes.values()) {
                            pushEdge(edgeMap, srcNodeId, {
                                type: CallEdgeType.RETURN,
                                srcNodeId,
                                dstNodeId,
                                callSiteId,
                                callerMethodName: caller.getName(),
                                calleeMethodName: callee.getName(),
                            });
                            syntheticReturnCount++;
                        }
                    }
                }
            }
        }
    }

    log(`Synthetic Invoke Edge Map Built: ${syntheticCallCount} call edges, ${syntheticReturnCount} return edges, ${nameFallbackCalleeCount} name-fallback callees.`);
    return edgeMap;
}

export function buildSyntheticConstructorStoreMap(
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    log: (msg: string) => void
): Map<number, SyntheticConstructorStoreInfo[]> {
    const map = new Map<number, SyntheticConstructorStoreInfo[]>();
    const summaryCache = new Map<string, Map<number, Set<string>>>();
    const visiting = new Set<string>();
    let count = 0;

    for (const caller of scene.getMethods()) {
        const cfg = caller.getCfg();
        if (!cfg) continue;

        for (const stmt of cfg.getStmts()) {
            if (!stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;

            const callSites = cg.getCallSiteByStmt(stmt) || [];
            if (callSites.length > 0) continue;

            const calleeSig = invokeExpr.getMethodSignature().toString();
            if (!calleeSig || calleeSig.includes("%unk") || !calleeSig.includes(".constructor(")) continue;

            const callee = scene.getMethods().find(m => m.getSignature().toString() === calleeSig);
            if (!callee || !callee.getCfg()) continue;

            const summary = summarizeConstructorParamToFields(scene, callee, summaryCache, visiting);
            if (summary.size === 0) continue;

            const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            const base = invokeExpr.getBase();
            const baseNodes = pag.getNodesByValue(base);
            if (!baseNodes || baseNodes.size === 0) continue;

            for (const [paramIndex, fieldNames] of summary.entries()) {
                if (paramIndex < 0 || paramIndex >= args.length) continue;
                const srcArg = args[paramIndex]!;
                const srcNodes = pag.getNodesByValue(srcArg);
                if (!srcNodes || srcNodes.size === 0) continue;

                for (const srcNodeId of srcNodes.values()) {
                    for (const baseNodeId of baseNodes.values()) {
                        const baseNode = pag.getNode(baseNodeId) as PagNode;
                        for (const objId of baseNode.getPointTo()) {
                            for (const fieldName of fieldNames) {
                                pushCtorStore(map, srcNodeId, { srcNodeId, objId, fieldName });
                                count++;
                            }
                        }
                    }
                }
            }
        }
    }

    log(`Synthetic Constructor Store Map Built: ${count} field-store transfers.`);
    return map;
}

function summarizeConstructorParamToFields(
    scene: Scene,
    method: any,
    cache: Map<string, Map<number, Set<string>>>,
    visiting: Set<string>
): Map<number, Set<string>> {
    const sig = method.getSignature().toString();
    if (cache.has(sig)) return cache.get(sig)!;
    if (visiting.has(sig)) return new Map();
    visiting.add(sig);

    const result = new Map<number, Set<string>>();
    const cfg = method.getCfg();
    if (!cfg) {
        visiting.delete(sig);
        cache.set(sig, result);
        return result;
    }

    const paramAssigns = cfg.getStmts().filter((s: any) => s instanceof ArkAssignStmt && s.getRightOp() instanceof ArkParameterRef) as ArkAssignStmt[];
    const localToParamIndex = new Map<string, number>();
    for (let i = 0; i < paramAssigns.length; i++) {
        const lhs = paramAssigns[i].getLeftOp();
        if (lhs instanceof Local) {
            localToParamIndex.set(lhs.getName(), i);
        }
    }

    for (const stmt of cfg.getStmts()) {
        if (stmt instanceof ArkAssignStmt) {
            const left = stmt.getLeftOp();
            const right = stmt.getRightOp();
            if (left instanceof ArkInstanceFieldRef && right instanceof Local) {
                const paramIdx = localToParamIndex.get(right.getName());
                if (paramIdx !== undefined) {
                    if (!result.has(paramIdx)) result.set(paramIdx, new Set());
                    result.get(paramIdx)!.add(left.getFieldSignature().getFieldName());
                }
            }
        }

        if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
        const invokeExpr = stmt.getInvokeExpr();
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
        const calleeSig = invokeExpr.getMethodSignature().toString();
        if (!calleeSig || calleeSig.includes("%unk") || !calleeSig.includes(".constructor(")) continue;

        const callee = scene.getMethods().find(m => m.getSignature().toString() === calleeSig);
        if (!callee || !callee.getCfg()) continue;
        const calleeSummary = summarizeConstructorParamToFields(scene, callee, cache, visiting);
        if (calleeSummary.size === 0) continue;

        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        for (const [calleeParamIdx, calleeFields] of calleeSummary.entries()) {
            if (calleeParamIdx < 0 || calleeParamIdx >= args.length) continue;
            const argVal = args[calleeParamIdx]!;
            if (!(argVal instanceof Local)) continue;
            const callerParamIdx = localToParamIndex.get(argVal.getName());
            if (callerParamIdx === undefined) continue;

            if (!result.has(callerParamIdx)) result.set(callerParamIdx, new Set());
            for (const f of calleeFields) {
                result.get(callerParamIdx)!.add(f);
            }
        }
    }

    visiting.delete(sig);
    cache.set(sig, result);
    return result;
}

function pushEdge(map: Map<number, SyntheticInvokeEdgeInfo[]>, key: number, edge: SyntheticInvokeEdgeInfo): void {
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(edge);
}

function pushCtorStore(map: Map<number, SyntheticConstructorStoreInfo[]>, key: number, info: SyntheticConstructorStoreInfo): void {
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(info);
}

function simpleHash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h) + s.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h % 10000);
}
