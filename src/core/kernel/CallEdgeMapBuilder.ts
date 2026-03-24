import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { CallGraph } from "../../../arkanalyzer/out/src/callgraph/model/CallGraph";
import { Pag, PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt, ArkReturnStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceFieldRef, ClosureFieldRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import { CallEdgeInfo, CallEdgeType } from "./context/TaintContext";
import {
    analyzeInvokedParams,
    collectParameterAssignStmts,
    isReflectDispatchInvoke,
    mapInvokeArgsToParamAssigns,
    resolveCalleeCandidates
} from "../substrate/queries/CalleeResolver";
import { summarizeConstructorCapturedLocalToFields } from "./SyntheticInvokeEdgeBuilder";

export interface CaptureEdgeInfo {
    srcNodeId: number;
    dstNodeId: number;
    callSiteId: number;
    callerMethodName: string;
    calleeMethodName: string;
    direction: "forward" | "backward";
}

interface CaptureEdgeDescriptor {
    srcValue: any;
    srcAnchorStmt: any;
    dstValue: any;
    dstAnchorStmt: any;
    callSiteId: number;
    callerMethodName: string;
    calleeMethodName: string;
    direction: "forward" | "backward";
}

interface CaptureLazySite {
    id: number;
    descriptors: CaptureEdgeDescriptor[];
}

export interface CaptureLazyMaterializer {
    siteIdsByTriggerNodeId: Map<number, number[]>;
    sites: CaptureLazySite[];
    materializedSiteIds: Set<number>;
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
    const lazy = buildCaptureLazyMaterializer(scene, cg, pag);
    let captureEdgesFound = 0;

    for (const site of lazy.sites) {
        captureEdgesFound += materializeCaptureSite(pag, captureEdgeMap, site);
    }

    log(`Capture Edge Map Built: ${captureEdgesFound} synthetic capture edges.`);
    return captureEdgeMap;
}

export function buildCaptureLazyMaterializer(
    scene: Scene,
    cg: CallGraph,
    pag: Pag
): CaptureLazyMaterializer {
    const capturedSummaryCache = new Map<string, Map<string, Set<string>>>();
    const capturedVisiting = new Set<string>();
    const siteIdsByTriggerNodeId = new Map<number, number[]>();
    const sites: CaptureLazySite[] = [];

    let siteId = 0;
    for (const method of scene.getMethods()) {
        const cfg = method.getCfg();
        const body = method.getBody();
        if (!cfg || !body) continue;
        const callerLocals = body.getLocals();

        for (const stmt of cfg.getStmts()) {
            if (!stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!invokeExpr) continue;

            const descriptors = collectCaptureDescriptorsForInvokeStmt(
                scene,
                cg,
                pag,
                method,
                callerLocals,
                stmt,
                invokeExpr,
                capturedSummaryCache,
                capturedVisiting
            );
            if (descriptors.length === 0) continue;

            const currentSiteId = siteId++;
            sites.push({ id: currentSiteId, descriptors });
            for (const nodeId of collectCaptureTriggerNodeIds(pag, descriptors)) {
                if (!siteIdsByTriggerNodeId.has(nodeId)) {
                    siteIdsByTriggerNodeId.set(nodeId, []);
                }
                siteIdsByTriggerNodeId.get(nodeId)!.push(currentSiteId);
            }
        }
    }

    return {
        siteIdsByTriggerNodeId,
        sites,
        materializedSiteIds: new Set<number>(),
    };
}

export function materializeCaptureSitesForNode(
    pag: Pag,
    edgeMap: Map<number, CaptureEdgeInfo[]>,
    lazy: CaptureLazyMaterializer,
    nodeId: number
): number {
    const siteIds = lazy.siteIdsByTriggerNodeId.get(nodeId) || [];
    let added = 0;
    for (const siteId of siteIds) {
        if (lazy.materializedSiteIds.has(siteId)) continue;
        lazy.materializedSiteIds.add(siteId);
        const site = lazy.sites.find(item => item.id === siteId);
        if (!site) continue;
        added += materializeCaptureSite(pag, edgeMap, site);
    }
    return added;
}

function materializeCaptureSite(
    pag: Pag,
    edgeMap: Map<number, CaptureEdgeInfo[]>,
    site: CaptureLazySite
): number {
    let count = 0;
    for (const descriptor of site.descriptors) {
        const srcNodes = getOrCreatePagNodes(pag, descriptor.srcValue, descriptor.srcAnchorStmt);
        const dstNodes = getOrCreatePagNodes(pag, descriptor.dstValue, descriptor.dstAnchorStmt);
        if (!srcNodes || srcNodes.size === 0 || !dstNodes || dstNodes.size === 0) continue;

        for (const srcNodeId of srcNodes.values()) {
            for (const dstNodeId of dstNodes.values()) {
                if (!edgeMap.has(srcNodeId)) {
                    edgeMap.set(srcNodeId, []);
                }
                edgeMap.get(srcNodeId)!.push({
                    srcNodeId,
                    dstNodeId,
                    callSiteId: descriptor.callSiteId,
                    callerMethodName: descriptor.callerMethodName,
                    calleeMethodName: descriptor.calleeMethodName,
                    direction: descriptor.direction,
                });
                count++;
            }
        }
    }
    return count;
}

function collectCaptureTriggerNodeIds(
    pag: Pag,
    descriptors: CaptureEdgeDescriptor[]
): Set<number> {
    const out = new Set<number>();
    for (const descriptor of descriptors) {
        const srcNodes = getOrCreatePagNodes(pag, descriptor.srcValue, descriptor.srcAnchorStmt);
        if (!srcNodes) continue;
        for (const nodeId of srcNodes.values()) {
            out.add(nodeId);
        }
    }
    return out;
}

function collectCaptureDescriptorsForInvokeStmt(
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    method: any,
    callerLocals: Map<string, Local>,
    stmt: any,
    invokeExpr: any,
    capturedSummaryCache: Map<string, Map<string, Set<string>>>,
    capturedVisiting: Set<string>
): CaptureEdgeDescriptor[] {
    const descriptors: CaptureEdgeDescriptor[] = [];
    const calleeMethods: { method: any; callSiteId: number; argCount: number }[] = [];

    const callSites = cg.getCallSiteByStmt(stmt) || [];
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
        const argCount = invokeExpr.getArgs ? invokeExpr.getArgs().length : 0;
        for (const resolved of resolveCalleeCandidates(scene, invokeExpr)) {
            const targetSig = resolved.method.getSignature().toString();
            const callSiteId = stmt.getOriginPositionInfo().getLineNo() * 10000 + thisSimpleHash(targetSig);
            calleeMethods.push({ method: resolved.method, callSiteId, argCount });
        }
    }

    for (const calleeInfo of calleeMethods) {
        const calleeMethod = calleeInfo.method;
        if (!calleeMethod || !calleeMethod.getCfg()) continue;

        const callerName = method.getName();
        const calleeName = calleeMethod.getName();
        const callSiteId = calleeInfo.callSiteId;
        const captureTargets = collectNoArgCalleeClosure(scene, calleeMethod);

        for (const targetMethod of captureTargets) {
            const targetCfg = targetMethod.getCfg();
            if (!targetCfg) continue;

            const capturedLocalsToFields = summarizeCapturedLocalsForClosureMethod(
                scene,
                targetMethod,
                capturedSummaryCache,
                capturedVisiting
            );

            if (capturedLocalsToFields.size === 0) {
                const closureParamBwds = collectClosuresParamWriteBackDescriptors(
                    pag, targetMethod, callerLocals, stmt, callSiteId, callerName, calleeName
                );
                descriptors.push(...closureParamBwds);
                continue;
            }

            const fieldReadLocals = collectClosureFieldReadLocals(targetMethod);
            const fieldWriteLocals = collectClosureFieldWriteLocals(targetMethod);
            if (fieldReadLocals.size === 0 && fieldWriteLocals.size === 0) continue;

            for (const [callerLocalName, fieldNames] of capturedLocalsToFields.entries()) {
                const callerLocal = callerLocals.get(callerLocalName);
                if (!(callerLocal instanceof Local)) continue;
                const callerNodes = getOrCreatePagNodes(pag, callerLocal, stmt);
                if (!callerNodes || callerNodes.size === 0) continue;

                for (const fieldName of fieldNames) {
                    for (const readAccess of fieldReadLocals.get(fieldName) || []) {
                        descriptors.push({
                            srcValue: callerLocal,
                            srcAnchorStmt: stmt,
                            dstValue: readAccess.local,
                            dstAnchorStmt: readAccess.anchorStmt || stmt,
                            callSiteId,
                            callerMethodName: callerName,
                            calleeMethodName: calleeName,
                            direction: "forward",
                        });
                    }

                    for (const writeAccess of fieldWriteLocals.get(fieldName) || []) {
                        descriptors.push({
                            srcValue: writeAccess.local,
                            srcAnchorStmt: writeAccess.anchorStmt || stmt,
                            dstValue: callerLocal,
                            dstAnchorStmt: stmt,
                            callSiteId,
                            callerMethodName: callerName,
                            calleeMethodName: calleeName,
                            direction: "backward",
                        });
                    }
                }
            }
        }
    }

    for (const calleeInfo of calleeMethods) {
        const calleeMethod = calleeInfo.method;
        if (!calleeMethod) continue;
        const invokedParams = analyzeInvokedParams(calleeMethod);
        if (invokedParams.size === 0) continue;

        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        for (const paramIdx of invokedParams) {
            if (paramIdx >= args.length) continue;
            const arg = args[paramIdx];
            if (!(arg instanceof Local)) continue;

            const closureMethod = resolveLocalToClosureMethod(scene, method, arg);
            if (!closureMethod || !closureMethod.getCfg()) continue;

            const bwdDescs = collectClosuresParamWriteBackDescriptors(
                pag, closureMethod, callerLocals, stmt,
                calleeInfo.callSiteId, method.getName(), closureMethod.getName()
            );
            descriptors.push(...bwdDescs);
        }
    }

    return descriptors;
}

function resolveLocalToClosureMethod(scene: Scene, callerMethod: any, argLocal: Local): any | null {
    const cfg = callerMethod?.getCfg?.();
    if (!cfg) return null;

    let targetName = argLocal.getName();
    const visited = new Set<string>();
    let rounds = 0;
    while (rounds < 4 && !visited.has(targetName)) {
        visited.add(targetName);
        rounds++;
        let found = false;
        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            const right = stmt.getRightOp();
            if (!(left instanceof Local) || left.getName() !== targetName) continue;
            if (!(right instanceof Local)) continue;
            const rhsName = right.getName();
            if (rhsName.includes("%AM")) {
                return scene.getMethods().find(m => m.getName() === rhsName) || null;
            }
            targetName = rhsName;
            found = true;
            break;
        }
        if (!found) break;
    }
    return null;
}

function summarizeCapturedLocalsForClosureMethod(
    scene: Scene,
    method: any,
    cache: Map<string, Map<string, Set<string>>>,
    visiting: Set<string>
): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    const classSig = method?.getDeclaringArkClass?.()?.getSignature?.()?.toString?.() || "";
    if (!classSig) return result;

    for (const candidate of scene.getMethods()) {
        const candidateClassSig = candidate?.getDeclaringArkClass?.()?.getSignature?.()?.toString?.() || "";
        if (candidateClassSig !== classSig) continue;
        const name = candidate.getName?.() || "";
        if (!(name.includes("constructor(") || name.includes("%instInit"))) continue;

        const summary = summarizeConstructorCapturedLocalToFields(scene, candidate, cache, visiting);
        for (const [localName, fields] of summary.entries()) {
            if (!result.has(localName)) result.set(localName, new Set<string>());
            for (const field of fields) {
                result.get(localName)!.add(field);
            }
        }
    }

    return result;
}

interface FieldLocalAccess {
    local: Local;
    anchorStmt: any;
}

function collectClosureFieldReadLocals(method: any): Map<string, FieldLocalAccess[]> {
    const result = new Map<string, FieldLocalAccess[]>();
    const cfg = method?.getCfg?.();
    if (!cfg) return result;

    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof Local)) continue;
        if (!(right instanceof ArkInstanceFieldRef) && !(right instanceof ClosureFieldRef)) continue;

        const base = right.getBase?.();
        const isClosureCarrier = right instanceof ClosureFieldRef
            || ((base instanceof Local) && (base.getName() === "this" || base.getName().startsWith("%closures")));
        if (!isClosureCarrier) continue;

        const fieldName = right instanceof ClosureFieldRef
            ? right.getFieldName?.()
            : right.getFieldSignature?.().getFieldName?.();
        if (!fieldName) continue;

        if (!result.has(fieldName)) result.set(fieldName, []);
        result.get(fieldName)!.push({ local: left, anchorStmt: stmt });
    }

    return result;
}

function collectClosureFieldWriteLocals(method: any): Map<string, FieldLocalAccess[]> {
    const result = new Map<string, FieldLocalAccess[]>();
    const cfg = method?.getCfg?.();
    if (!cfg) return result;

    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(right instanceof Local)) continue;
        if (!(left instanceof ArkInstanceFieldRef) && !(left instanceof ClosureFieldRef)) continue;

        const base = left.getBase?.();
        const isClosureCarrier = left instanceof ClosureFieldRef
            || ((base instanceof Local) && (base.getName() === "this" || base.getName().startsWith("%closures")));
        if (!isClosureCarrier) continue;

        const fieldName = left instanceof ClosureFieldRef
            ? left.getFieldName?.()
            : left.getFieldSignature?.().getFieldName?.();
        if (!fieldName) continue;

        if (!result.has(fieldName)) result.set(fieldName, []);
        result.get(fieldName)!.push({ local: right, anchorStmt: stmt });
    }

    return result;
}

function collectClosuresParamWriteBackDescriptors(
    pag: Pag,
    closureMethod: any,
    callerLocals: Map<string, Local>,
    callerStmt: any,
    callSiteId: number,
    callerMethodName: string,
    calleeMethodName: string
): CaptureEdgeDescriptor[] {
    const result: CaptureEdgeDescriptor[] = [];
    const cfg = closureMethod?.getCfg?.();
    if (!cfg) return result;

    const capturedLocalToField = new Map<string, string>();
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof Local) || !(right instanceof ClosureFieldRef)) continue;
        const fieldName = right.getFieldName?.();
        if (!fieldName) continue;
        capturedLocalToField.set(left.getName(), fieldName);
    }
    if (capturedLocalToField.size === 0) return result;

    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof Local) || !(right instanceof Local)) continue;

        const overwrittenField = capturedLocalToField.get(left.getName());
        if (!overwrittenField) continue;

        const callerLocal = callerLocals.get(overwrittenField);
        if (!(callerLocal instanceof Local)) continue;
        const callerNodes = getOrCreatePagNodes(pag, callerLocal, callerStmt);
        if (!callerNodes || callerNodes.size === 0) continue;

        result.push({
            srcValue: right,
            srcAnchorStmt: stmt,
            dstValue: callerLocal,
            dstAnchorStmt: callerStmt,
            callSiteId,
            callerMethodName,
            calleeMethodName,
            direction: "backward",
        });
    }

    return result;
}

function getOrCreatePagNodes(pag: Pag, value: any, anchorStmt: any): Map<number, number> | undefined {
    let nodes = pag.getNodesByValue(value);
    if (nodes && nodes.size > 0) return nodes;
    if (!anchorStmt) return nodes;
    pag.addPagNode(0, value, anchorStmt);
    return pag.getNodesByValue(value);
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
