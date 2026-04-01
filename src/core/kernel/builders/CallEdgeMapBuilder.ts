import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { CallGraph } from "../../../../arkanalyzer/out/src/callgraph/model/CallGraph";
import { Pag, PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt, ArkReturnStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { ArkInstanceFieldRef, ArkParameterRef, ArkThisRef, ClosureFieldRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { CallEdgeInfo, CallEdgeType } from "../context/TaintContext";
import {
    analyzeInvokedParams,
    collectParameterAssignStmts,
    isReflectDispatchInvoke,
    mapInvokeArgsToParamAssigns,
    resolveCalleeCandidates,
    resolveMethodsFromCallable,
} from "../../substrate/queries/CalleeResolver";
import { summarizeConstructorCapturedLocalToFields } from "./SyntheticInvokeEdgeBuilder";
import { getMethodBySignature, getMethodBySimpleName } from "../contracts/MethodLookup";
import { safeGetOrCreatePagNodes } from "../contracts/PagNodeResolution";

export interface CaptureEdgeInfo {
    srcNodeId: number;
    dstNodeId: number;
    callSiteId: number;
    callerMethodName: string;
    calleeMethodName: string;
    direction: "forward" | "backward";
}

export interface ReceiverFieldBridgeInfo {
    sourceCarrierNodeId: number;
    targetCarrierNodeId: number;
    callSiteId: number;
    callerMethodName: string;
    calleeMethodName: string;
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
    siteById: Map<number, CaptureLazySite>;
    materializedSiteIds: Set<number>;
}

interface ResolvedCallTarget {
    method: any;
    explicitArgs: any[];
    callSiteSalt: number;
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
            const resolvedTargets = collectResolvedCallTargets(scene, cg, stmt, invokeExpr);
            if (resolvedTargets.length === 0) continue;

            for (const target of resolvedTargets) {
                const calleeMethod = target.method;
                if (!calleeMethod?.getCfg?.()) continue;

                const callerName = method.getName();
                const calleeName = calleeMethod.getName();
                const stableCallSiteId = stmt.getOriginPositionInfo().getLineNo() * 10000 + target.callSiteSalt;
                const explicitArgs = target.explicitArgs;
                const paramStmts = collectParameterAssignStmts(calleeMethod);
                const pairs = mapInvokeArgsToParamAssigns(invokeExpr, explicitArgs, paramStmts);

                if (invokeExpr instanceof ArkInstanceInvokeExpr) {
                    const receiverValues = collectThisReceiverValues(calleeMethod);
                    if (receiverValues.length > 0) {
                        const srcNodes = pag.getNodesByValue(invokeExpr.getBase());
                        if (srcNodes) {
                            for (const receiverValue of receiverValues) {
                                const dstNodes = pag.getNodesByValue(receiverValue);
                                if (!dstNodes) continue;
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
                        }
                    }
                }

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

export function buildReceiverFieldBridgeMap(
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    log: (msg: string) => void
): Map<number, ReceiverFieldBridgeInfo[]> {
    const bridgeMap = new Map<number, ReceiverFieldBridgeInfo[]>();
    const dedup = new Set<string>();
    let bridgeCount = 0;

    const pushBridge = (info: ReceiverFieldBridgeInfo): void => {
        const key = `${info.sourceCarrierNodeId}->${info.targetCarrierNodeId}@${info.callSiteId}`;
        if (dedup.has(key)) return;
        dedup.add(key);
        if (!bridgeMap.has(info.sourceCarrierNodeId)) {
            bridgeMap.set(info.sourceCarrierNodeId, []);
        }
        bridgeMap.get(info.sourceCarrierNodeId)!.push(info);
        bridgeCount += 1;
    };

    for (const method of scene.getMethods()) {
        const cfg = method.getCfg?.();
        if (!cfg) continue;

        for (const stmt of cfg.getStmts()) {
            if (!stmt.containsInvokeExpr?.()) continue;
            const invokeExpr = stmt.getInvokeExpr?.();
            if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;

            const base = invokeExpr.getBase();
            if (!(base instanceof Local)) continue;

            const resolvedTargets = collectResolvedCallTargets(scene, cg, stmt, invokeExpr);
            if (resolvedTargets.length === 0) continue;

            for (const target of resolvedTargets) {
                const calleeMethod = target.method;
                if (!calleeMethod?.getCfg?.()) continue;

                const callSiteId = stmt.getOriginPositionInfo().getLineNo() * 10000 + target.callSiteSalt;
                const callerCarrierIds = collectCarrierNodeIds(pag, [base]);
                if (callerCarrierIds.size === 0) continue;

                const receiverValues = collectThisReceiverValues(calleeMethod);
                if (receiverValues.length === 0) continue;
                const calleeCarrierIds = collectMethodCarrierNodeIds(pag, calleeMethod, receiverValues);
                if (calleeCarrierIds.size === 0) continue;

                for (const sourceCarrierNodeId of calleeCarrierIds) {
                    for (const targetCarrierNodeId of callerCarrierIds) {
                        pushBridge({
                            sourceCarrierNodeId,
                            targetCarrierNodeId,
                            callSiteId,
                            callerMethodName: method.getName(),
                            calleeMethodName: calleeMethod.getName(),
                        });
                    }
                }
            }
        }
    }

    log(`Receiver Field Bridge Map Built: ${bridgeCount} receiver field write-back transfers.`);
    return bridgeMap;
}
function collectResolvedCallTargets(
    scene: Scene,
    cg: CallGraph,
    stmt: any,
    invokeExpr: any,
): ResolvedCallTarget[] {
    const out: ResolvedCallTarget[] = [];
    const seen = new Set<string>();
    const add = (method: any, explicitArgs: any[], callSiteSalt: number): void => {
        if (!method?.getCfg?.()) return;
        const sig = method.getSignature?.()?.toString?.();
        if (!sig || seen.has(sig)) return;
        seen.add(sig);
        out.push({ method, explicitArgs, callSiteSalt });
    };

    const callSites = cg.getCallSiteByStmt(stmt) || [];
    for (const cs of callSites) {
        const calleeFuncID = cs.getCalleeFuncID?.();
        if (!calleeFuncID) continue;
        add(
            cg.getArkMethodByFuncID(calleeFuncID),
            cs.args || (invokeExpr.getArgs ? invokeExpr.getArgs() : []),
            calleeFuncID,
        );
    }

    const invokeSig = invokeExpr?.getMethodSignature?.()?.toString?.() || "";
    if (out.length > 0 && !isReflectDispatchInvoke(invokeExpr) && !invokeSig.includes("%unk")) {
        return out;
    }

    for (const resolved of resolveCalleeCandidates(scene, invokeExpr)) {
        const sig = resolved.method?.getSignature?.()?.toString?.() || "";
        add(
            resolved.method,
            invokeExpr.getArgs ? invokeExpr.getArgs() : [],
            simpleHash(sig || resolved.reason),
        );
    }

    return out;
}

function simpleHash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = (h * 131 + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
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
        siteById: new Map<number, CaptureLazySite>(sites.map(site => [site.id, site])),
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
        const site = lazy.siteById.get(siteId);
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

function collectThisReceiverValues(method: any): any[] {
    const cfg = method?.getCfg?.();
    if (!cfg) return [];
    const out: any[] = [];
    const seen = new Set<string>();
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const right = stmt.getRightOp();
        if (!(right instanceof ArkThisRef)) continue;
        const left = stmt.getLeftOp();
        const addValue = (value: any): void => {
            if (!value) return;
            const key = value.toString?.() || String(value);
            if (seen.has(key)) return;
            seen.add(key);
            out.push(value);
        };
        addValue(right);
        addValue(left);
    }
    return out;
}
function collectMethodCarrierNodeIds(
    pag: Pag,
    method: any,
    values: any[],
): Set<number> {
    const out = collectCarrierNodeIds(pag, values);
    const receiverObjectIds = new Set<number>();
    for (const nodeId of out) {
        const node = pag.getNode(nodeId) as PagNode;
        if (!node) continue;
        for (const objId of node.getPointTo()) {
            receiverObjectIds.add(objId);
            out.add(objId);
        }
    }
    if (receiverObjectIds.size === 0) {
        return out;
    }

    const methodSig = method?.getSignature?.()?.toString?.() || "";
    for (const rawNode of pag.getNodesIter()) {
        const node = rawNode as PagNode;
        const nodeMethodSig = resolveNodeDeclaringMethodSignature(node);
        if (!nodeMethodSig || nodeMethodSig !== methodSig) continue;
        for (const objId of node.getPointTo()) {
            if (!receiverObjectIds.has(objId)) continue;
            out.add(node.getID());
            break;
        }
    }
    return out;
}

function resolveNodeDeclaringMethodSignature(node: PagNode): string | undefined {
    const stmtMethodSig = node.getStmt?.()?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.();
    if (stmtMethodSig) return stmtMethodSig;
    return (node.getValue?.() as any)?.getDeclaringStmt?.()?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.();
}
function collectCarrierNodeIds(
    pag: Pag,
    values: any[],
): Set<number> {
    const out = new Set<number>();
    for (const value of values) {
        const nodes = value ? pag.getNodesByValue(value) : undefined;
        if (!nodes) continue;
        for (const nodeId of nodes.values()) {
            out.add(nodeId);
            const node = pag.getNode(nodeId) as PagNode;
            if (!node) continue;
            for (const objId of node.getPointTo()) {
                out.add(objId);
            }
        }
    }
    return out;
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
        const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        const capturedLocalSourceValues = buildCapturedLocalSourceValues(calleeMethod, invokeExpr, explicitArgs);
        const captureTargets = collectClosureCaptureTargets(scene, calleeMethod);

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
                const sourceValues = resolveCapturedLocalSourceValues(
                    callerLocals,
                    capturedLocalSourceValues,
                    callerLocalName,
                );
                if (sourceValues.length === 0) continue;

                for (const sourceValue of sourceValues) {
                    const sourceNodes = getOrCreatePagNodes(pag, sourceValue, stmt);
                    if (!sourceNodes || sourceNodes.size === 0) continue;

                    for (const fieldName of fieldNames) {
                        for (const readAccess of fieldReadLocals.get(fieldName) || []) {
                            descriptors.push({
                                srcValue: sourceValue,
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
                                dstValue: sourceValue,
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
                return getMethodBySimpleName(scene, rhsName) || null;
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
    mergeCapturedLocalFieldSummary(result, summarizeDirectClosureEnvLocalToFields(method));
    const classSig = method?.getDeclaringArkClass?.()?.getSignature?.()?.toString?.() || "";
    if (!classSig) return result;

    for (const candidate of scene.getMethods()) {
        const candidateClassSig = candidate?.getDeclaringArkClass?.()?.getSignature?.()?.toString?.() || "";
        if (candidateClassSig !== classSig) continue;
        const name = candidate.getName?.() || "";
        if (!(name.includes("constructor(") || name.includes("%instInit"))) continue;

        const summary = summarizeConstructorCapturedLocalToFields(scene, candidate, cache, visiting);
        mergeCapturedLocalFieldSummary(result, summary);
    }

    return result;
}

function summarizeDirectClosureEnvLocalToFields(method: any): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
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
            || ((base instanceof Local) && base.getName().startsWith("%closures"));
        if (!isClosureCarrier) continue;

        const fieldName = right instanceof ClosureFieldRef
            ? right.getFieldName?.()
            : right.getFieldSignature?.().getFieldName?.();
        if (!fieldName) continue;

        if (!result.has(left.getName())) result.set(left.getName(), new Set<string>());
        result.get(left.getName())!.add(fieldName);
    }

    return result;
}

function mergeCapturedLocalFieldSummary(
    target: Map<string, Set<string>>,
    source: Map<string, Set<string>>,
): void {
    for (const [localName, fields] of source.entries()) {
        if (!target.has(localName)) target.set(localName, new Set<string>());
        for (const field of fields) {
            target.get(localName)!.add(field);
        }
    }
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
    return safeGetOrCreatePagNodes(pag, value, anchorStmt);
}

function collectNoArgCalleeClosure(scene: Scene, startMethod: any): any[] {
    const results: any[] = [];
    const queue: any[] = [startMethod];
    const visited = new Set<string>();

    for (let head = 0; head < queue.length; head++) {
        const method = queue[head];
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
            const callee = getMethodBySignature(scene, calleeSig);
            if (callee) queue.push(callee);
        }
    }

    return results;
}

function collectClosureCaptureTargets(scene: Scene, calleeMethod: any): any[] {
    const out: any[] = [];
    const seen = new Set<string>();
    const addMethod = (method: any): void => {
        const sig = method?.getSignature?.()?.toString?.();
        if (!sig || seen.has(sig) || !method?.getCfg?.()) return;
        seen.add(sig);
        out.push(method);
    };

    for (const method of collectNoArgCalleeClosure(scene, calleeMethod)) {
        addMethod(method);
    }
    for (const method of collectReturnedCallableCaptureTargets(scene, calleeMethod)) {
        addMethod(method);
    }

    return out;
}

function collectReturnedCallableCaptureTargets(scene: Scene, method: any): any[] {
    const out: any[] = [];
    const seen = new Set<string>();
    const addMethod = (candidate: any): void => {
        const sig = candidate?.getSignature?.()?.toString?.();
        if (!sig || seen.has(sig) || !candidate?.getCfg?.()) return;
        seen.add(sig);
        out.push(candidate);
    };

    for (const retStmt of method?.getReturnStmt?.() || []) {
        const returnedValue = (retStmt as ArkReturnStmt).getOp?.();
        if (!returnedValue) continue;
        for (const candidate of resolveMethodsFromCallable(scene, returnedValue, { maxCandidates: 8 })) {
            addMethod(candidate);
        }
    }

    return out;
}

function buildCapturedLocalSourceValues(
    calleeMethod: any,
    invokeExpr: any,
    explicitArgs: any[],
): Map<string, any[]> {
    const result = new Map<string, any[]>();
    const cfg = calleeMethod?.getCfg?.();
    if (!cfg) return result;

    const paramStmts = collectParameterAssignStmts(calleeMethod);
    const pairs = mapInvokeArgsToParamAssigns(invokeExpr, explicitArgs, paramStmts);
    for (const pair of pairs) {
        const left = pair.paramStmt.getLeftOp();
        if (!(left instanceof Local)) continue;
        pushCapturedLocalSourceValue(result, left.getName(), pair.arg);
    }

    let changed = true;
    let rounds = 0;
    while (changed && rounds < 4) {
        changed = false;
        rounds += 1;
        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            if (!(left instanceof Local)) continue;

            const inherited = resolveCapturedLocalAliasedSources(result, stmt.getRightOp());
            if (inherited.length === 0) continue;
            if (mergeCapturedLocalSourceValues(result, left.getName(), inherited)) {
                changed = true;
            }
        }
    }

    return result;
}

function resolveCapturedLocalSourceValues(
    callerLocals: Map<string, Local>,
    calleeCapturedSources: Map<string, any[]>,
    capturedLocalName: string,
): any[] {
    const callerLocal = callerLocals.get(capturedLocalName);
    if (callerLocal instanceof Local) {
        return [callerLocal];
    }
    return [...(calleeCapturedSources.get(capturedLocalName) || [])];
}

function resolveCapturedLocalAliasedSources(
    capturedSources: Map<string, any[]>,
    value: any,
): any[] {
    if (value instanceof Local) {
        return [...(capturedSources.get(value.getName()) || [])];
    }
    if (value?.getOp) {
        return resolveCapturedLocalAliasedSources(capturedSources, value.getOp());
    }
    if (value?.getPromise) {
        return resolveCapturedLocalAliasedSources(capturedSources, value.getPromise());
    }
    return [];
}

function mergeCapturedLocalSourceValues(
    target: Map<string, any[]>,
    localName: string,
    values: any[],
): boolean {
    let changed = false;
    const existing = target.get(localName) || [];
    const seen = new Set(existing.map(value => String(value?.toString?.() || value)));
    for (const value of values) {
        const key = String(value?.toString?.() || value);
        if (seen.has(key)) continue;
        seen.add(key);
        existing.push(value);
        changed = true;
    }
    if (changed || !target.has(localName)) {
        target.set(localName, existing);
    }
    return changed;
}

function pushCapturedLocalSourceValue(
    target: Map<string, any[]>,
    localName: string,
    value: any,
): void {
    mergeCapturedLocalSourceValues(target, localName, [value]);
}

function thisSimpleHash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h) + s.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h % 10000);
}
