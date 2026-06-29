import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { CallGraph } from "../../../../arkanalyzer/out/src/callgraph/model/CallGraph";
import { Pag, PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt, ArkReturnStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkAwaitExpr, ArkCastExpr, ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { ArkArrayRef, ArkInstanceFieldRef, ArkParameterRef, ArkThisRef, ClosureFieldRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { CallEdgeInfo, CallEdgeType } from "../context/TaintContext";
import {
    analyzeInvokedParams,
    collectParameterAssignStmts,
    isReflectDispatchInvoke,
    mapInvokeArgsToParamAssigns,
    diagnoseUnresolvedVirtualDispatch,
    resolveCalleeCandidates,
    resolveMethodsFromCallable,
} from "../../substrate/queries/CalleeResolver";
import { summarizeConstructorCapturedLocalToFields } from "./SyntheticInvokeEdgeBuilder";
import { getMethodBySignature, getMethodBySimpleName } from "../contracts/MethodLookup";
import { buildExecutionHandoffSiteKeyFromStmt } from "../handoff/ExecutionHandoffSiteKey";
import { collectOrdinaryTaintPreservingSourceLocals } from "../ordinary/OrdinaryLanguagePropagation";
import { assertBuildStageBudget, BuildStageBudget } from "../../shared/BuildStageBudget";

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
export interface PagIndexBuildBudget {
    startedAtMs: number;
    maxElapsedMs?: number;
    label: string;
}

export class PagIndexBuildBudgetExceededError extends Error {
    readonly code = "PAG_INDEX_BUILD_BUDGET_EXCEEDED";
    readonly label: string;
    readonly elapsedMs: number;
    readonly maxElapsedMs: number;

    constructor(label: string, elapsedMs: number, maxElapsedMs: number) {
        super(`${label} exceeded ${maxElapsedMs}ms (elapsed=${elapsedMs}ms)`);
        this.name = "PagIndexBuildBudgetExceededError";
        this.label = label;
        this.elapsedMs = elapsedMs;
        this.maxElapsedMs = maxElapsedMs;
    }
}

function assertPagIndexBudget(budget: PagIndexBuildBudget | undefined): void {
    if (!budget?.maxElapsedMs || budget.maxElapsedMs <= 0) return;
    const elapsedMs = Date.now() - budget.startedAtMs;
    if (elapsedMs <= budget.maxElapsedMs) return;
    throw new PagIndexBuildBudgetExceededError(budget.label, elapsedMs, budget.maxElapsedMs);
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

export interface CaptureLazyMaterializerBuildOptions {
    progress?: (msg: string) => void;
    progressInterval?: number;
}

interface ResolvedCallTarget {
    method: any;
    explicitArgs: any[];
    callSiteSalt: number;
}

export interface CallEdgeMapBuildOptions {
    diagnostics?: "enabled" | "disabled";
    progress?: (msg: string) => void;
    progressEveryMethods?: number;
    methods?: Iterable<any>;
}

interface CaptureDescriptorCaches {
    closureCaptureTargetsByMethodSig: Map<string, any[]>;
    directCapturedInvokeArgLocalsByMethodSig: Map<string, Map<string, FieldLocalAccess[]>>;
    closureFieldReadLocalsByMethodSig: Map<string, Map<string, FieldLocalAccess[]>>;
    closureFieldWriteLocalsByMethodSig: Map<string, Map<string, FieldLocalAccess[]>>;
    invokedParamsByMethodSig: Map<string, Set<number>>;
    callableClosureMethodsByKey: Map<string, any[]>;
    closureParamWriteBackDescriptorsByKey: Map<string, CaptureEdgeDescriptor[]>;
    constructorMethodsByClassSig: Map<string, any[]>;
}

function createCaptureDescriptorCaches(): CaptureDescriptorCaches {
    return {
        closureCaptureTargetsByMethodSig: new Map(),
        directCapturedInvokeArgLocalsByMethodSig: new Map(),
        closureFieldReadLocalsByMethodSig: new Map(),
        closureFieldWriteLocalsByMethodSig: new Map(),
        invokedParamsByMethodSig: new Map(),
        callableClosureMethodsByKey: new Map(),
        closureParamWriteBackDescriptorsByKey: new Map(),
        constructorMethodsByClassSig: new Map(),
    };
}

export function buildCallEdgeMap(
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    log: (msg: string) => void,
    options: CallEdgeMapBuildOptions = {},
): Map<string, CallEdgeInfo> {
    const callEdgeMap = new Map<string, CallEdgeInfo>();
    const progress = options.progress || log;
    const diagnosticsEnabled = options.diagnostics !== "disabled";
    const progressEveryMethods = options.progressEveryMethods || 100;
    const methods = options.methods ? [...options.methods] : scene.getMethods();
    progress(`[call-edge-map] build start methods=${methods.length} diagnostics=${diagnosticsEnabled ? "enabled" : "disabled"}`);

    let callEdgesFound = 0;
    let returnEdgesFound = 0;
    let virtualDispatchGaps = 0;
    const virtualDispatchGapSites = new Set<string>();

    let methodIndex = 0;
    for (const method of methods) {
        methodIndex++;
        if (methodIndex === 1 || methodIndex % progressEveryMethods === 0) {
            progress(
                `[call-edge-map] scanning method #${methodIndex}/${methods.length} `
                + `current=${method.getName?.() || "<unknown>"}`,
            );
        }
        const cfg = method.getCfg();
        if (!cfg) continue;

        for (const stmt of cfg.getStmts()) {
            if (!stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!invokeExpr) continue;
            const resolvedTargets = collectResolvedCallTargets(scene, cg, stmt, invokeExpr, {
                diagnoseUnresolvedVirtualDispatch: diagnosticsEnabled,
            });
            if (resolvedTargets.length === 0) {
                const gap = diagnosticsEnabled
                    ? diagnoseUnresolvedVirtualDispatch(scene, invokeExpr)
                    : undefined;
                if (gap) {
                    const lineNo = stmt.getOriginPositionInfo?.().getLineNo?.() ?? -1;
                    const callerSig = method.getSignature?.()?.toString?.() || method.getName?.() || "";
                    const siteKey = `${callerSig}:${lineNo}:${gap.invokeSignature}:${gap.methodName}`;
                    if (!virtualDispatchGapSites.has(siteKey)) {
                        virtualDispatchGapSites.add(siteKey);
                        virtualDispatchGaps++;
                        log(
                            `[virtual_dispatch_unresolved] caller=${method.getName()} line=${lineNo} `
                            + `method=${gap.methodName} receiver=${gap.receiverOwner || gap.receiverType || "unresolved"} `
                            + `candidates=${gap.candidateCount} evidence=${gap.evidence.join(",")}`
                        );
                    }
                }
                continue;
            }

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

                if (!isAssignStmtLike(stmt)) continue;

                const retDst = stmt.getLeftOp();
                const retStmts = calleeMethod.getReturnStmt();
                for (const retStmt of retStmts) {
                    const retValue = (retStmt as ArkReturnStmt).getOp();
                    const srcNodes = resolveReturnValueNodes(pag, retValue);
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

    const exactReturnEdges = materializeExactSignatureReturnEdges(scene, pag, callEdgeMap, log, methods);
    returnEdgesFound += exactReturnEdges;

    progress(`Call Edge Map Built: ${callEdgesFound} call edges, ${returnEdgesFound} return edges, ${virtualDispatchGaps} virtual dispatch gaps.`);
    return callEdgeMap;
}

function materializeExactSignatureReturnEdges(
    scene: Scene,
    pag: Pag,
    callEdgeMap: Map<string, CallEdgeInfo>,
    log?: (msg: string) => void,
    methods?: Iterable<any>,
): number {
    let returnEdgesFound = 0;
    const trace = process.env.ARKTAINT_TRACE_CALL_EDGE_MAP === "1";
    for (const method of methods || scene.getMethods()) {
        const cfg = method.getCfg();
        if (!cfg) continue;
        const callerName = method.getName();

        for (const stmt of cfg.getStmts()) {
            if (!isAssignStmtLike(stmt) || !stmt.containsInvokeExpr?.()) continue;
            const invokeExpr = stmt.getInvokeExpr?.();
            if (!invokeExpr) continue;
            const calleeSig = invokeExpr.getMethodSignature?.()?.toString?.() || "";
            if (!calleeSig || calleeSig.includes("%unk")) continue;
            const calleeMethod = getMethodBySignature(scene, calleeSig);
            if (!calleeMethod?.getCfg?.()) {
                if (trace) log?.(`[ReturnEdgeExact-SKIP] no callee for ${calleeSig}`);
                continue;
            }

            const calleeName = calleeMethod.getName();
            const lineNo = stmt.getOriginPositionInfo?.().getLineNo?.() ?? -1;
            const callSiteId = resolveExistingCallSiteId(callEdgeMap, callerName, calleeName, lineNo);
            if (callSiteId === undefined) {
                if (trace) log?.(`[ReturnEdgeExact-SKIP] no exact call edge caller=${callerName} callee=${calleeName} stmt=${stmt.toString?.() || ""}`);
                continue;
            }
            const retDst = stmt.getLeftOp();
            const dstNodes = pag.getNodesByValue(retDst);
            if (!dstNodes) {
                if (trace) log?.(`[ReturnEdgeExact-SKIP] no dst nodes caller=${callerName} callee=${calleeName} stmt=${stmt.toString?.() || ""}`);
                continue;
            }

            for (const retStmt of calleeMethod.getReturnStmt?.() || []) {
                const retValue = (retStmt as any).getOp?.();
                const srcNodes = resolveReturnValueNodes(pag, retValue);
                if (!srcNodes) {
                    if (trace) log?.(`[ReturnEdgeExact-SKIP] no src nodes caller=${callerName} callee=${calleeName} ret=${retStmt.toString?.() || ""}`);
                    continue;
                }
                for (const srcId of srcNodes.values()) {
                    const srcNode = pag.getNode(srcId) as PagNode;
                    const copyEdges = [...(srcNode.getOutgoingCopyEdges()?.values() || [])];
                    if (copyEdges.length === 0) {
                        if (trace) log?.(`[ReturnEdgeExact-SKIP] no copy edges src=${srcId} caller=${callerName} callee=${calleeName}`);
                        continue;
                    }
                    for (const dstId of dstNodes.values()) {
                        for (const edge of copyEdges) {
                            if (edge.getDstID() !== dstId) continue;
                            const edgeKey = `${srcId}->${dstId}`;
                            const existing = callEdgeMap.get(edgeKey);
                            if (existing?.type === CallEdgeType.RETURN) continue;
                            callEdgeMap.set(edgeKey, {
                                type: CallEdgeType.RETURN,
                                callSiteId,
                                callerMethodName: callerName,
                                calleeMethodName: calleeName,
                            });
                            returnEdgesFound++;
                            if (trace) log?.(`[ReturnEdgeExact] ${calleeName} -> ${callerName} ${srcId}->${dstId} callsite=${callSiteId}`);
                        }
                    }
                }
            }
        }
    }
    return returnEdgesFound;
}

function resolveExistingCallSiteId(
    callEdgeMap: Map<string, CallEdgeInfo>,
    callerMethodName: string,
    calleeMethodName: string,
    lineNo: number,
): number | undefined {
    for (const edge of callEdgeMap.values()) {
        if (edge.type !== CallEdgeType.CALL) continue;
        if (edge.callerMethodName !== callerMethodName || edge.calleeMethodName !== calleeMethodName) continue;
        if (lineNo >= 0 && Math.floor(edge.callSiteId / 10000) !== lineNo) continue;
        return edge.callSiteId;
    }
    return undefined;
}

function isAssignStmtLike(stmt: any): stmt is ArkAssignStmt {
    return stmt instanceof ArkAssignStmt
        || (!!stmt && typeof stmt.getLeftOp === "function" && typeof stmt.getRightOp === "function");
}

function resolveReturnValueNodes(
    pag: Pag,
    value: any,
    visiting: Set<any> = new Set<any>(),
): Map<number, number> | undefined {
    if (!value || visiting.has(value)) return undefined;
    visiting.add(value);

    const out = new Map<number, number>();
    mergeNodeMaps(out, getExistingPagNodes(pag, value));

    if (value instanceof ArkCastExpr) {
        mergeNodeMaps(out, resolveReturnValueNodes(pag, value.getOp?.(), visiting));
    } else if (value instanceof ArkAwaitExpr) {
        mergeNodeMaps(out, resolveReturnValueNodes(pag, value.getPromise?.(), visiting));
    } else if ((value instanceof ArkStaticInvokeExpr || value instanceof ArkInstanceInvokeExpr) && isPromiseResolveInvoke(value)) {
        const args = value.getArgs?.() || [];
        if (args.length > 0) {
            mergeNodeMaps(out, resolveReturnValueNodes(pag, args[0], visiting));
        }
    } else if (value instanceof Local) {
        const decl = value.getDeclaringStmt?.();
        if (decl instanceof ArkAssignStmt && decl.getLeftOp?.() === value) {
            mergeNodeMaps(out, resolveReturnValueNodes(pag, decl.getRightOp?.(), visiting));
        }
    } else if (
        value instanceof ArkInstanceFieldRef
        || value instanceof ArkArrayRef
        || value instanceof ArkParameterRef
        || value instanceof ArkThisRef
        || value instanceof ClosureFieldRef
    ) {
        mergeNodeMaps(out, getExistingPagNodes(pag, value));
    }

    visiting.delete(value);
    return out.size > 0 ? out : undefined;
}

function mergeNodeMaps(target: Map<number, number>, src: Map<number, number> | undefined): void {
    if (!src) return;
    for (const value of src.values()) {
        target.set(value, value);
    }
}

function isPromiseResolveInvoke(value: ArkStaticInvokeExpr | ArkInstanceInvokeExpr): boolean {
    const signature = value.getMethodSignature?.();
    const methodName = signature?.getMethodSubSignature?.()?.getMethodName?.() || "";
    const signatureText = signature?.toString?.() || "";
    if (methodName !== "resolve") return false;
    if (signatureText && !signatureText.includes("%unk")) {
        return signatureText.includes("Promise.") || signatureText.includes(".Promise");
    }
    const base = value instanceof ArkInstanceInvokeExpr ? value.getBase() : undefined;
    if (!(base instanceof Local)) return false;
    if (base.getName?.() !== "Promise") return false;
    return (value.getArgs?.() || []).length >= 1;
}

function hasUnresolvedVirtualDispatchEvidence(scene: Scene, invokeExpr: any): boolean {
    const gap = diagnoseUnresolvedVirtualDispatch(scene, invokeExpr);
    if (!gap) return false;
    const evidence = new Set(gap.evidence);
    return evidence.has("interface_targets")
        && (evidence.has("missing_concrete_receiver_owner") || evidence.has("ambiguous_receiver_owner"));
}

export function buildReceiverFieldBridgeMap(
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    log: (msg: string) => void,
    budget?: PagIndexBuildBudget,
    options: { methods?: Iterable<any> } = {},
): Map<number, ReceiverFieldBridgeInfo[]> {
    const bridgeMap = new Map<number, ReceiverFieldBridgeInfo[]>();
    const dedup = new Set<string>();
    const pagNodesByDeclaringMethod = buildPagNodeIndexByDeclaringMethod(pag, budget);
    const receiverValuesByMethodSig = new Map<string, any[]>();
    const carrierIdsByMethodSig = new Map<string, Set<number>>();
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

    const methods = options.methods ? [...options.methods] : scene.getMethods();
    for (const method of methods) {
        assertPagIndexBudget(budget);
        const cfg = method.getCfg?.();
        if (!cfg) continue;

        for (const stmt of cfg.getStmts()) {
            assertPagIndexBudget(budget);
            if (!stmt.containsInvokeExpr?.()) continue;
            const invokeExpr = stmt.getInvokeExpr?.();
            if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;

            const base = invokeExpr.getBase();
            if (!(base instanceof Local)) continue;

            const resolvedTargets = collectResolvedCallTargets(scene, cg, stmt, invokeExpr);
            if (resolvedTargets.length === 0) continue;

            for (const target of resolvedTargets) {
                assertPagIndexBudget(budget);
                const calleeMethod = target.method;
                if (!calleeMethod?.getCfg?.()) continue;

                const callSiteId = stmt.getOriginPositionInfo().getLineNo() * 10000 + target.callSiteSalt;
                const callerCarrierIds = collectCarrierNodeIds(pag, [base]);
                if (callerCarrierIds.size === 0) continue;

                const calleeMethodSig = resolveMethodSignature(calleeMethod);
                const receiverValues = getCachedThisReceiverValues(calleeMethod, calleeMethodSig, receiverValuesByMethodSig);
                if (receiverValues.length === 0) continue;
                const calleeCarrierIds = getCachedMethodCarrierNodeIds(
                    pag,
                    calleeMethod,
                    receiverValues,
                    pagNodesByDeclaringMethod,
                    carrierIdsByMethodSig,
                );
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

function buildPagNodeIndexByDeclaringMethod(
    pag: Pag,
    budget?: PagIndexBuildBudget,
): Map<string, PagNode[]> {
    const byMethod = new Map<string, PagNode[]>();
    for (const rawNode of pag.getNodesIter()) {
        assertPagIndexBudget(budget);
        const node = rawNode as PagNode;
        const methodSig = resolveNodeDeclaringMethodSignature(node);
        if (!methodSig) continue;
        const existing = byMethod.get(methodSig);
        if (existing) {
            existing.push(node);
        } else {
            byMethod.set(methodSig, [node]);
        }
    }
    return byMethod;
}

function resolveMethodSignature(method: any): string {
    return method?.getSignature?.()?.toString?.() || method?.getName?.() || "";
}

function getCachedThisReceiverValues(
    method: any,
    methodSig: string,
    cache: Map<string, any[]>,
): any[] {
    const key = methodSig || `method:${method?.getName?.() || "unknown"}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const values = collectThisReceiverValues(method);
    cache.set(key, values);
    return values;
}

function getCachedMethodCarrierNodeIds(
    pag: Pag,
    method: any,
    values: any[],
    pagNodesByDeclaringMethod: Map<string, PagNode[]>,
    cache: Map<string, Set<number>>,
): Set<number> {
    const methodSig = resolveMethodSignature(method);
    const key = methodSig || `method:${method?.getName?.() || "unknown"}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const ids = collectMethodCarrierNodeIds(
        pag,
        method,
        values,
        methodSig ? (pagNodesByDeclaringMethod.get(methodSig) || []) : undefined,
    );
    cache.set(key, ids);
    return ids;
}
function collectResolvedCallTargets(
    scene: Scene,
    cg: CallGraph,
    stmt: any,
    invokeExpr: any,
    options: { diagnoseUnresolvedVirtualDispatch?: boolean } = {},
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
    const hasUnresolvedVirtualDispatch = options.diagnoseUnresolvedVirtualDispatch === false
        ? false
        : hasUnresolvedVirtualDispatchEvidence(scene, invokeExpr);
    if (
        out.length > 0
        && !isReflectDispatchInvoke(invokeExpr)
        && !invokeSig.includes("%unk")
        && !hasUnresolvedVirtualDispatch
    ) {
        return out;
    }
    if (hasUnresolvedVirtualDispatch) {
        return [];
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
    log: (msg: string) => void,
    excludedDeferredSiteKeys?: ReadonlySet<string>,
): Map<number, CaptureEdgeInfo[]> {
    const captureEdgeMap = new Map<number, CaptureEdgeInfo[]>();
    const lazy = buildCaptureLazyMaterializer(scene, cg, pag, excludedDeferredSiteKeys);
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
    pag: Pag,
    excludedDeferredSiteKeys?: ReadonlySet<string>,
    budget?: BuildStageBudget,
    options: CaptureLazyMaterializerBuildOptions = {},
): CaptureLazyMaterializer {
    const progress = options.progress;
    const progressInterval = options.progressInterval ?? 200;
    const capturedSummaryCache = new Map<string, Map<string, Set<string>>>();
    const capturedVisiting = new Set<string>();
    const descriptorCaches = createCaptureDescriptorCaches();
    const siteIdsByTriggerNodeId = new Map<number, number[]>();
    const sites: CaptureLazySite[] = [];

    let siteId = 0;
    const methods = scene.getMethods();
    let scannedMethods = 0;
    for (const method of methods) {
        scannedMethods++;
        if (scannedMethods === 1 || scannedMethods % progressInterval === 0) {
            progress?.(
                `[capture-lazy] scanning method #${scannedMethods}/${methods.length} `
                + `current=${method.getName?.() || "<unknown>"} sites=${sites.length}`,
            );
        }
        assertBuildStageBudget(budget, "capture_lazy.methods");
        const cfg = method.getCfg();
        const body = method.getBody();
        if (!cfg || !body) continue;
        const callerLocals = body.getLocals();

        for (const stmt of cfg.getStmts()) {
            assertBuildStageBudget(budget, "capture_lazy.statements");
            if (!stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!invokeExpr) continue;
            const siteKey = buildExecutionHandoffSiteKeyFromStmt(method, stmt);
            const suppressForwardDeferredCapture = excludedDeferredSiteKeys?.has(siteKey) || false;

            const descriptors = collectCaptureDescriptorsForInvokeStmt(
                scene,
                cg,
                pag,
                method,
                callerLocals,
                stmt,
                invokeExpr,
                suppressForwardDeferredCapture,
                capturedSummaryCache,
                capturedVisiting,
                descriptorCaches,
                budget,
            );
            assertBuildStageBudget(budget, "capture_lazy.descriptors");
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
    progress?.(`[capture-lazy] done methods=${scannedMethods} sites=${sites.length} triggers=${siteIdsByTriggerNodeId.size}`);

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
        added += materializeCaptureSite(pag, edgeMap, site, nodeId);
    }
    return added;
}

function materializeCaptureSite(
    pag: Pag,
    edgeMap: Map<number, CaptureEdgeInfo[]>,
    site: CaptureLazySite,
    triggerNodeId?: number,
): number {
    let count = 0;
    for (const descriptor of site.descriptors) {
        const srcNodes = getExistingPagNodes(pag, descriptor.srcValue);
        const dstNodes = getExistingPagNodes(pag, descriptor.dstValue);
        if (!srcNodes || srcNodes.size === 0 || !dstNodes || dstNodes.size === 0) continue;

        for (const srcNodeId of srcNodes.values()) {
            for (const dstNodeId of dstNodes.values()) {
                const edgeInfo: CaptureEdgeInfo = {
                    srcNodeId,
                    dstNodeId,
                    callSiteId: descriptor.callSiteId,
                    callerMethodName: descriptor.callerMethodName,
                    calleeMethodName: descriptor.calleeMethodName,
                    direction: descriptor.direction,
                };
                if (!edgeMap.has(srcNodeId)) {
                    edgeMap.set(srcNodeId, []);
                }
                edgeMap.get(srcNodeId)!.push(edgeInfo);
                if (triggerNodeId !== undefined && triggerNodeId !== srcNodeId) {
                    if (!edgeMap.has(triggerNodeId)) {
                        edgeMap.set(triggerNodeId, []);
                    }
                    edgeMap.get(triggerNodeId)!.push(edgeInfo);
                }
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
    methodNodes?: PagNode[],
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
    if (methodNodes) {
        for (const node of methodNodes) {
            for (const objId of node.getPointTo()) {
                if (!receiverObjectIds.has(objId)) continue;
                out.add(node.getID());
                break;
            }
        }
        return out;
    }

    if (!methodSig) {
        return out;
    }
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
        const srcNodes = getExistingPagNodes(pag, descriptor.srcValue);
        if (!srcNodes) continue;
        for (const nodeId of srcNodes.values()) {
            out.add(nodeId);
            const srcNode = pag.getNode(nodeId) as PagNode;
            for (const objId of srcNode?.getPointTo?.() || []) {
                out.add(objId);
            }
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
    suppressForwardDeferredCapture: boolean,
    capturedSummaryCache: Map<string, Map<string, Set<string>>>,
    capturedVisiting: Set<string>,
    descriptorCaches: CaptureDescriptorCaches,
    budget?: BuildStageBudget,
): CaptureEdgeDescriptor[] {
    const descriptors: CaptureEdgeDescriptor[] = [];
    const calleeMethods: { method: any; callSiteId: number; argCount: number }[] = [];

    assertBuildStageBudget(budget, "capture_lazy.descriptors.callee_sites.start");
    const callSites = cg.getCallSiteByStmt(stmt) || [];
    for (const cs of callSites) {
        assertBuildStageBudget(budget, "capture_lazy.descriptors.callee_sites.iter");
        const calleeFuncID = cs.getCalleeFuncID();
        if (!calleeFuncID) continue;
        const calleeMethod = cg.getArkMethodByFuncID(calleeFuncID);
        if (!calleeMethod) continue;

        const argCount = invokeExpr.getArgs ? invokeExpr.getArgs().length : (cs.args ? cs.args.length : 0);
        const callSiteId = stmt.getOriginPositionInfo().getLineNo() * 10000 + calleeFuncID;
        calleeMethods.push({ method: calleeMethod, callSiteId, argCount });
    }
    assertBuildStageBudget(budget, `capture_lazy.descriptors.callee_sites.done(count=${calleeMethods.length})`);

    if ((calleeMethods.length === 0 || isReflectDispatchInvoke(invokeExpr))
        && shouldAttemptCaptureCandidateResolution(scene, invokeExpr)) {
        const argCount = invokeExpr.getArgs ? invokeExpr.getArgs().length : 0;
        assertBuildStageBudget(budget, "capture_lazy.descriptors.resolve_candidates.start");
        for (const resolved of resolveCalleeCandidates(scene, invokeExpr, { enableDirectCallableTargets: false })) {
            assertBuildStageBudget(budget, "capture_lazy.descriptors.resolve_candidates.iter");
            const targetSig = resolved.method.getSignature().toString();
            const callSiteId = stmt.getOriginPositionInfo().getLineNo() * 10000 + thisSimpleHash(targetSig);
            calleeMethods.push({ method: resolved.method, callSiteId, argCount });
        }
        assertBuildStageBudget(budget, `capture_lazy.descriptors.resolve_candidates.done(count=${calleeMethods.length})`);
    }

    for (const calleeInfo of calleeMethods) {
        assertBuildStageBudget(budget, `capture_lazy.descriptors.callee.start(${shortMethodLabel(calleeInfo.method)})`);
        const calleeMethod = calleeInfo.method;
        if (!calleeMethod || !calleeMethod.getCfg()) continue;

        const callerName = method.getName();
        const calleeName = calleeMethod.getName();
        const callSiteId = calleeInfo.callSiteId;
        const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        const capturedLocalSourceValues = buildCapturedLocalSourceValues(calleeMethod, invokeExpr, explicitArgs);
        const calleeLocals = calleeMethod.getBody?.()?.getLocals?.() || new Map<string, Local>();
        assertBuildStageBudget(budget, `capture_lazy.descriptors.capture_targets.start(${shortMethodLabel(calleeMethod)})`);
        const captureTargets = collectClosureCaptureTargetsCached(scene, calleeMethod, descriptorCaches);
        assertBuildStageBudget(budget, `capture_lazy.descriptors.capture_targets.done(count=${captureTargets.length},callee=${shortMethodLabel(calleeMethod)})`);
        if (collectDirectCapturedInvokeArgLocalsCached(calleeMethod, descriptorCaches).size > 0) {
            const calleeSig = calleeMethod.getSignature?.().toString?.();
            const alreadyIncluded = captureTargets.some(
                target => target?.getSignature?.()?.toString?.() === calleeSig,
            );
            if (!alreadyIncluded) {
                captureTargets.push(calleeMethod);
            }
        }

        for (const targetMethod of captureTargets) {
            assertBuildStageBudget(budget, `capture_lazy.descriptors.target.start(${shortMethodLabel(targetMethod)})`);
            const targetCfg = targetMethod.getCfg();
            if (!targetCfg) continue;

            const directCapturedInvokeArgLocals = collectDirectCapturedInvokeArgLocalsCached(targetMethod, descriptorCaches);
            assertBuildStageBudget(budget, `capture_lazy.descriptors.field_access.start(${shortMethodLabel(targetMethod)})`);
            const fieldReadLocals = collectClosureFieldReadLocalsCached(targetMethod, descriptorCaches);
            const fieldWriteLocals = collectClosureFieldWriteLocalsCached(targetMethod, descriptorCaches);
            assertBuildStageBudget(budget, `capture_lazy.descriptors.field_access.done(read=${fieldReadLocals.size},write=${fieldWriteLocals.size},target=${shortMethodLabel(targetMethod)})`);
            if (directCapturedInvokeArgLocals.size === 0 && fieldReadLocals.size === 0 && fieldWriteLocals.size === 0) {
                continue;
            }

            assertBuildStageBudget(budget, `capture_lazy.descriptors.target_summary.start(${shortMethodLabel(targetMethod)})`);
            const capturedLocalsToFields = summarizeCapturedLocalsForClosureMethod(
                scene,
                targetMethod,
                capturedSummaryCache,
                capturedVisiting,
                descriptorCaches,
            );
            assertBuildStageBudget(budget, `capture_lazy.descriptors.target_summary.done(size=${capturedLocalsToFields.size},target=${shortMethodLabel(targetMethod)})`);
            if (fieldReadLocals.size > 0) {
                assertBuildStageBudget(budget, `capture_lazy.descriptors.param_writeback.start(${shortMethodLabel(targetMethod)})`);
                const closureParamBwds = collectClosuresParamWriteBackDescriptorsCached(
                    pag, targetMethod, callerLocals, stmt, callSiteId, callerName, calleeName, descriptorCaches
                );
                descriptors.push(...closureParamBwds);
                assertBuildStageBudget(budget, `capture_lazy.descriptors.param_writeback.done(count=${closureParamBwds.length},target=${shortMethodLabel(targetMethod)})`);
            }
            for (const [callerLocalName, directUses] of directCapturedInvokeArgLocals.entries()) {
                assertBuildStageBudget(budget, `capture_lazy.descriptors.direct_arg.start(${shortMethodLabel(targetMethod)}:${callerLocalName})`);
                const sourceValues = resolveCapturedLocalSourceValues(
                    callerLocals,
                    calleeLocals,
                    capturedLocalSourceValues,
                    callerLocalName,
                );
                if (sourceValues.length === 0) continue;
                for (const sourceValue of sourceValues) {
                    assertBuildStageBudget(budget, `capture_lazy.descriptors.direct_arg.source_nodes.start(${shortMethodLabel(targetMethod)}:${callerLocalName})`);
                    const sourceNodes = getExistingPagNodes(pag, sourceValue);
                    assertBuildStageBudget(budget, `capture_lazy.descriptors.direct_arg.source_nodes.done(${shortMethodLabel(targetMethod)}:${callerLocalName})`);
                    if (!sourceNodes || sourceNodes.size === 0) continue;
                    for (const directUse of directUses) {
                        if (suppressForwardDeferredCapture) continue;
                        descriptors.push({
                            srcValue: sourceValue,
                            srcAnchorStmt: resolvePagAnchorStmtForValue(sourceValue, stmt),
                            dstValue: directUse.local,
                            dstAnchorStmt: directUse.anchorStmt || stmt,
                            callSiteId,
                            callerMethodName: callerName,
                            calleeMethodName: calleeName,
                            direction: "forward",
                        });
                    }
                }
            }

            if (capturedLocalsToFields.size === 0) {
                continue;
            }

            if (fieldReadLocals.size === 0 && fieldWriteLocals.size === 0) continue;

            for (const [callerLocalName, fieldNames] of capturedLocalsToFields.entries()) {
                assertBuildStageBudget(budget, `capture_lazy.descriptors.field_descriptors.start(${shortMethodLabel(targetMethod)}:${callerLocalName})`);
                const sourceValues = resolveCapturedLocalSourceValues(
                    callerLocals,
                    calleeLocals,
                    capturedLocalSourceValues,
                    callerLocalName,
                );
                if (sourceValues.length === 0) continue;

                for (const sourceValue of sourceValues) {
                    assertBuildStageBudget(budget, `capture_lazy.descriptors.field_descriptors.source_nodes.start(${shortMethodLabel(targetMethod)}:${callerLocalName})`);
                    const sourceNodes = getExistingPagNodes(pag, sourceValue);
                    assertBuildStageBudget(budget, `capture_lazy.descriptors.field_descriptors.source_nodes.done(${shortMethodLabel(targetMethod)}:${callerLocalName})`);
                    if (!sourceNodes || sourceNodes.size === 0) continue;

                    for (const fieldName of fieldNames) {
                        for (const readAccess of fieldReadLocals.get(fieldName) || []) {
                            if (suppressForwardDeferredCapture) continue;
                            descriptors.push({
                                srcValue: sourceValue,
                                srcAnchorStmt: resolvePagAnchorStmtForValue(sourceValue, stmt),
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
                assertBuildStageBudget(budget, `capture_lazy.descriptors.field_descriptors.done(${shortMethodLabel(targetMethod)}:${callerLocalName})`);
            }
        }
        assertBuildStageBudget(budget, `capture_lazy.descriptors.callee.done(${shortMethodLabel(calleeMethod)})`);
    }

    for (const calleeInfo of calleeMethods) {
        const calleeMethod = calleeInfo.method;
        if (!calleeMethod) continue;
        assertBuildStageBudget(budget, `capture_lazy.descriptors.invoked_params.start(${shortMethodLabel(calleeMethod)})`);
        const invokedParams = analyzeInvokedParamsCached(calleeMethod, descriptorCaches);
        assertBuildStageBudget(budget, `capture_lazy.descriptors.invoked_params.done(count=${invokedParams.size},callee=${shortMethodLabel(calleeMethod)})`);
        if (invokedParams.size === 0) continue;

        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        for (const paramIdx of invokedParams) {
            assertBuildStageBudget(budget, `capture_lazy.descriptors.invoked_param.iter(${shortMethodLabel(calleeMethod)}:${paramIdx})`);
            if (paramIdx >= args.length) continue;
            const arg = args[paramIdx];
            if (!(arg instanceof Local)) continue;

            const closureMethods = resolveCallableToClosureMethodsCached(scene, method, arg, descriptorCaches);
            for (const closureMethod of closureMethods) {
                assertBuildStageBudget(budget, `capture_lazy.descriptors.invoked_param.writeback.start(${shortMethodLabel(closureMethod)})`);
                if (!closureMethod?.getCfg?.()) continue;

                const bwdDescs = collectClosuresParamWriteBackDescriptorsCached(
                    pag, closureMethod, callerLocals, stmt,
                    calleeInfo.callSiteId, method.getName(), closureMethod.getName(), descriptorCaches
                );
                descriptors.push(...bwdDescs);
                assertBuildStageBudget(budget, `capture_lazy.descriptors.invoked_param.writeback.done(count=${bwdDescs.length},closure=${shortMethodLabel(closureMethod)})`);
            }
        }
    }

    return descriptors;
}

function shouldAttemptCaptureCandidateResolution(scene: Scene, invokeExpr: any): boolean {
    if (!invokeExpr) return false;
    const invokeSig = invokeExpr?.getMethodSignature?.()?.toString?.() || "";
    if (invokeSig && !invokeSig.includes("%unk")) return true;
    const gap = diagnoseUnresolvedVirtualDispatch(scene, invokeExpr);
    if (!gap) return true;
    const evidence = new Set(gap.evidence || []);
    if (evidence.has("missing_concrete_receiver_owner")) return false;
    if (evidence.has("ambiguous_receiver_owner")) return false;
    if (evidence.has("name_candidates_exceed_limit")) return false;
    if (evidence.has("receiver_owner_candidates_not_unique")) return false;
    return gap.candidateCount <= 1;
}

function methodSignatureKey(method: any): string {
    return method?.getSignature?.()?.toString?.() || method?.getName?.() || String(method || "");
}

function shortMethodLabel(method: any): string {
    const sig = methodSignatureKey(method);
    if (sig.length <= 96) return sig;
    return `${sig.slice(0, 48)}...${sig.slice(-40)}`;
}

function stmtLocationKey(stmt: any): string {
    const pos = stmt?.getOriginPositionInfo?.();
    const line = pos?.getLineNo?.();
    const column = pos?.getColNo?.() ?? pos?.getColumnNo?.();
    return `${line ?? "?"}:${column ?? "?"}`;
}

function collectClosureCaptureTargetsCached(
    scene: Scene,
    calleeMethod: any,
    caches: CaptureDescriptorCaches,
): any[] {
    const key = methodSignatureKey(calleeMethod);
    if (!key) return collectClosureCaptureTargets(scene, calleeMethod);
    const cached = caches.closureCaptureTargetsByMethodSig.get(key);
    if (cached) return [...cached];
    const targets = collectClosureCaptureTargets(scene, calleeMethod);
    caches.closureCaptureTargetsByMethodSig.set(key, [...targets]);
    return targets;
}

function collectDirectCapturedInvokeArgLocalsCached(
    method: any,
    caches: CaptureDescriptorCaches,
): Map<string, FieldLocalAccess[]> {
    const key = methodSignatureKey(method);
    if (!key) return collectDirectCapturedInvokeArgLocals(method);
    let cached = caches.directCapturedInvokeArgLocalsByMethodSig.get(key);
    if (!cached) {
        cached = collectDirectCapturedInvokeArgLocals(method);
        caches.directCapturedInvokeArgLocalsByMethodSig.set(key, cached);
    }
    return cached;
}

function collectClosureFieldReadLocalsCached(
    method: any,
    caches: CaptureDescriptorCaches,
): Map<string, FieldLocalAccess[]> {
    const key = methodSignatureKey(method);
    if (!key) return collectClosureFieldReadLocals(method);
    let cached = caches.closureFieldReadLocalsByMethodSig.get(key);
    if (!cached) {
        cached = collectClosureFieldReadLocals(method);
        caches.closureFieldReadLocalsByMethodSig.set(key, cached);
    }
    return cached;
}

function collectClosureFieldWriteLocalsCached(
    method: any,
    caches: CaptureDescriptorCaches,
): Map<string, FieldLocalAccess[]> {
    const key = methodSignatureKey(method);
    if (!key) return collectClosureFieldWriteLocals(method);
    let cached = caches.closureFieldWriteLocalsByMethodSig.get(key);
    if (!cached) {
        cached = collectClosureFieldWriteLocals(method);
        caches.closureFieldWriteLocalsByMethodSig.set(key, cached);
    }
    return cached;
}

function analyzeInvokedParamsCached(
    method: any,
    caches: CaptureDescriptorCaches,
): Set<number> {
    const key = methodSignatureKey(method);
    if (!key) return analyzeInvokedParams(method);
    let cached = caches.invokedParamsByMethodSig.get(key);
    if (!cached) {
        cached = analyzeInvokedParams(method);
        caches.invokedParamsByMethodSig.set(key, cached);
    }
    return cached;
}

function resolveCallableToClosureMethodsCached(
    scene: Scene,
    callerMethod: any,
    argValue: any,
    caches: CaptureDescriptorCaches,
): any[] {
    const callerKey = methodSignatureKey(callerMethod);
    const argKey = argValue?.toString?.() || String(argValue || "");
    const key = `${callerKey}|${argKey}`;
    const cached = caches.callableClosureMethodsByKey.get(key);
    if (cached) return cached;
    const methods = resolveCallableToClosureMethods(scene, callerMethod, argValue);
    caches.callableClosureMethodsByKey.set(key, methods);
    return methods;
}

function collectClosuresParamWriteBackDescriptorsCached(
    pag: Pag,
    closureMethod: any,
    callerLocals: Map<string, Local>,
    callerStmt: any,
    callSiteId: number,
    callerMethodName: string,
    calleeMethodName: string,
    caches: CaptureDescriptorCaches,
): CaptureEdgeDescriptor[] {
    const key = [
        methodSignatureKey(closureMethod),
        callerMethodName,
        calleeMethodName,
        callSiteId,
        stmtLocationKey(callerStmt),
    ].join("|");
    const cached = caches.closureParamWriteBackDescriptorsByKey.get(key);
    if (cached) return cached;
    const descriptors = collectClosuresParamWriteBackDescriptors(
        pag,
        closureMethod,
        callerLocals,
        callerStmt,
        callSiteId,
        callerMethodName,
        calleeMethodName,
    );
    caches.closureParamWriteBackDescriptorsByKey.set(key, descriptors);
    return descriptors;
}

function resolveCallableToClosureMethods(scene: Scene, callerMethod: any, argValue: any): any[] {
    const out: any[] = [];
    const seen = new Set<string>();
    const addMethod = (candidate: any | null | undefined): void => {
        const sig = candidate?.getSignature?.()?.toString?.() || "";
        if (!sig || seen.has(sig) || !candidate?.getCfg?.()) return;
        seen.add(sig);
        out.push(candidate);
    };

    if (argValue instanceof Local) {
        addMethod(resolveLocalToClosureMethod(scene, callerMethod, argValue));
    }

    for (const candidate of resolveMethodsFromCallable(scene, argValue, { maxCandidates: 8 })) {
        addMethod(candidate);
    }

    return out;
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
    visiting: Set<string>,
    descriptorCaches: CaptureDescriptorCaches,
): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    mergeCapturedLocalFieldSummary(result, summarizeDirectClosureEnvLocalToFields(method));
    const classSig = method?.getDeclaringArkClass?.()?.getSignature?.()?.toString?.() || "";
    if (!classSig) return result;

    for (const candidate of collectConstructorMethodsForClassCached(scene, classSig, descriptorCaches)) {
        const summary = summarizeConstructorCapturedLocalToFields(scene, candidate, cache, visiting);
        mergeCapturedLocalFieldSummary(result, summary);
    }

    return result;
}

function collectConstructorMethodsForClassCached(
    scene: Scene,
    classSig: string,
    caches: CaptureDescriptorCaches,
): any[] {
    const cached = caches.constructorMethodsByClassSig.get(classSig);
    if (cached) return cached;
    const constructors: any[] = [];
    for (const candidate of scene.getMethods()) {
        const candidateClassSig = candidate?.getDeclaringArkClass?.()?.getSignature?.()?.toString?.() || "";
        if (candidateClassSig !== classSig) continue;
        const name = candidate.getName?.() || "";
        if (!(name.includes("constructor(") || name.includes("%instInit"))) continue;
        constructors.push(candidate);
    }
    caches.constructorMethodsByClassSig.set(classSig, constructors);
    return constructors;
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
        if (!(left instanceof Local)) continue;

        const overwrittenField = capturedLocalToField.get(left.getName());
        if (!overwrittenField) continue;

        const callerLocal = callerLocals.get(overwrittenField);
        if (!(callerLocal instanceof Local)) continue;
        const callerNodes = getExistingPagNodes(pag, callerLocal);
        if (!callerNodes || callerNodes.size === 0) continue;

        const sourceLocals = collectOrdinaryTaintPreservingSourceLocals(right);
        for (const sourceLocal of sourceLocals) {
            result.push({
                srcValue: sourceLocal,
                srcAnchorStmt: stmt,
                dstValue: callerLocal,
                dstAnchorStmt: callerStmt,
                callSiteId,
                callerMethodName,
                calleeMethodName,
                direction: "backward",
            });
        }
    }

    return result;
}

function getExistingPagNodes(pag: Pag, value: any): Map<number, number> | undefined {
    return pag.getNodesByValue(value);
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

function collectDirectCapturedInvokeArgLocals(method: any): Map<string, FieldLocalAccess[]> {
    const result = new Map<string, FieldLocalAccess[]>();
    const cfg = method?.getCfg?.();
    if (!cfg) return result;

    const paramLocalNames = new Set<string>();
    const assignedLocalNames = new Set<string>();
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (left instanceof Local) {
            assignedLocalNames.add(left.getName());
            if (right instanceof ArkParameterRef) {
                paramLocalNames.add(left.getName());
            }
        }
    }

    for (const stmt of cfg.getStmts()) {
        if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
        const invokeExpr = stmt.getInvokeExpr();
        const args = invokeExpr?.getArgs ? invokeExpr.getArgs() : [];
        for (const arg of args) {
            if (!(arg instanceof Local)) continue;
            const localName = arg.getName?.() || "";
            if (!isLikelyDirectCapturedLocalName(localName, paramLocalNames, assignedLocalNames)) continue;
            if (!result.has(localName)) result.set(localName, []);
            result.get(localName)!.push({ local: arg, anchorStmt: stmt });
        }
    }

    return result;
}

function isLikelyDirectCapturedLocalName(
    localName: string,
    paramLocalNames: Set<string>,
    assignedLocalNames: Set<string>,
): boolean {
    if (!localName) return false;
    if (localName === "this" || localName.endsWith(".this")) return false;
    if (localName.startsWith("%")) return false;
    if (paramLocalNames.has(localName)) return false;
    if (assignedLocalNames.has(localName)) return false;
    return true;
}

function resolveCapturedLocalSourceValues(
    callerLocals: Map<string, Local>,
    calleeLocals: Map<string, Local>,
    calleeCapturedSources: Map<string, any[]>,
    capturedLocalName: string,
): any[] {
    const callerLocal = callerLocals.get(capturedLocalName);
    if (callerLocal instanceof Local) {
        return [callerLocal];
    }
    const calleeLocal = calleeLocals.get(capturedLocalName);
    if (calleeLocal instanceof Local) {
        return [calleeLocal];
    }
    return [...(calleeCapturedSources.get(capturedLocalName) || [])];
}

function resolvePagAnchorStmtForValue(value: any, defaultStmt: any): any {
    return value?.getDeclaringStmt?.() || defaultStmt;
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
