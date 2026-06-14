import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { CallGraph } from "../../../../arkanalyzer/out/src/callgraph/model/CallGraph";
import { Pag, PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt, ArkReturnStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import {
    ArkStaticFieldRef,
    ArkArrayRef,
    ArkThisRef,
} from "../../../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { Constant } from "../../../../arkanalyzer/out/src/core/base/Constant";
import {
    ArkInstanceInvokeExpr,
    ArkNewArrayExpr,
    ArkNewExpr,
} from "../../../../arkanalyzer/out/src/core/base/Expr";
import { CallEdgeType } from "../context/TaintContext";
import {
    collectParameterAssignStmts,
    isReflectDispatchInvoke,
    mapInvokeArgsToParamAssigns,
    resolveCalleeCandidates,
    resolveInvokeMethodName,
} from "../../substrate/queries/CalleeResolver";
import { getMethodBySignature } from "../contracts/MethodLookup";
import { safeGetOrCreatePagNodes } from "../contracts/PagNodeResolution";
import { collectCarrierNodeIdsForValueAtStmt } from "../ordinary/OrdinaryAliasPropagation";
import {
    collectCallbackBindingTriggerNodeIds,
    collectResolvedInvokeTargets,
    collectResolvedCallbackBindingsForStmt,
    injectResolvedCallbackParameterEdges,
    resolveDynamicPropertyOneHopFallbackCallees,
    resolveReflectDispatchOneHopFallbackCallees,
    type AsyncCallbackBinding,
    type SyntheticInvokeLookupContext,
    type SyntheticInvokeLookupStats,
} from "./SyntheticInvokeCallbacks";
import { buildExecutionHandoffSiteKeyFromStmt } from "../handoff/ExecutionHandoffSiteKey";
import { assertBuildStageBudget, BuildStageBudget } from "../../shared/BuildStageBudget";
export {
    buildSyntheticConstructorStoreMap,
    buildSyntheticFieldBridgeMap,
    buildSyntheticStaticInitStoreMap,
    summarizeConstructorCapturedLocalToFields,
} from "./SyntheticInvokeSummaries";

export interface SyntheticInvokeEdgeInfo {
    type: CallEdgeType;
    srcNodeId: number;
    dstNodeId: number;
    callSiteId: number;
    callerMethodName: string;
    calleeMethodName: string;
    callerSignature?: string;
    calleeSignature?: string;
    originTag?: string;
    handoffId?: string;
    preserveFieldPath?: boolean;
}

export interface SyntheticConstructorStoreInfo {
    srcNodeId: number;
    objId: number;
    fieldName: string;
    sourceFieldPath?: string[];
}

export interface SyntheticFieldBridgeInfo {
    sourceObjectNodeId: number;
    sourceFieldName: string;
    targetObjectNodeId: number;
    targetFieldName: string;
    methodSignature: string;
}

export interface SyntheticStaticInitStoreInfo {
    srcNodeId: number;
    staticFieldNodeId: number;
}

interface SyntheticInvokeLazySite {
    id: number;
    caller: any;
    stmt: any;
    invokeExpr: any;
}

export interface SyntheticInvokeLazyMaterializer {
    siteIdsByTriggerNodeId: Map<number, number[]>;
    sites: SyntheticInvokeLazySite[];
    siteById: Map<number, SyntheticInvokeLazySite>;
    materializedSiteIds: Set<number>;
    eagerSiteIds: Set<number>;
    eagerSitesMaterialized: boolean;
    invokedParamCache: Map<string, Set<number>>;
    lookupContext: SyntheticInvokeLookupContext;
}

export function buildSyntheticInvokeEdges(
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    log: (msg: string) => void,
    excludedDeferredSiteKeys?: ReadonlySet<string>,
    forceDirectCallerSignatures?: ReadonlySet<string>,
): Map<number, SyntheticInvokeEdgeInfo[]> {
    // Deferred/future execution edges are emitted by algorithm D.
    // This builder only materializes synthetic invoke edges for synchronous invoke recovery.
    const buildStartMs = Date.now();
    const edgeMap = new Map<number, SyntheticInvokeEdgeInfo[]>();
    let syntheticCallCount = 0;
    let syntheticReturnCount = 0;
    let fallbackCalleeCount = 0;
    const lazy = buildSyntheticInvokeLazyMaterializer(scene, cg, pag, log);

    for (const site of lazy.sites) {
        const stats = materializeSyntheticInvokeSite(scene, cg, pag, edgeMap, lazy, site, excludedDeferredSiteKeys, forceDirectCallerSignatures);
        syntheticCallCount += stats.callCount;
        syntheticReturnCount += stats.returnCount;
        fallbackCalleeCount += stats.fallbackCalleeCount;
    }

    const totalMs = Date.now() - buildStartMs;
    const lookupMs = lazy.lookupContext.stats.incomingDirectScanMs + lazy.lookupContext.stats.incomingIndexBuildMs;
    const lookupRatio = totalMs > 0 ? ((lookupMs * 100) / totalMs) : 0;
    log(`Synthetic Invoke Edge Map Built: ${syntheticCallCount} call edges, ${syntheticReturnCount} return edges, ${fallbackCalleeCount} fallback callees.`);
    log(
        `Synthetic Invoke Lookup Stats: incomingCalls=${lazy.lookupContext.stats.incomingLookupCalls}, `
        + `incomingIndexBuilt=${lazy.lookupContext.stats.incomingIndexBuilt ? "yes" : "no"}, `
        + `incomingScanMs=${lazy.lookupContext.stats.incomingDirectScanMs.toFixed(1)}, `
        + `incomingIndexBuildMs=${lazy.lookupContext.stats.incomingIndexBuildMs.toFixed(1)}, `
        + `incomingLookupRatio=${lookupRatio.toFixed(1)}%, `
        + `methodLookupCalls=${lazy.lookupContext.stats.methodLookupCalls}, `
        + `methodLookupCacheHits=${lazy.lookupContext.stats.methodLookupCacheHits}`
    );
    return edgeMap;
}

export function buildSyntheticInvokeLazyMaterializer(
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    _log: (msg: string) => void,
    budget?: BuildStageBudget,
): SyntheticInvokeLazyMaterializer {
    const invokedParamCache = new Map<string, Set<number>>();
    const lookupContext: SyntheticInvokeLookupContext = {
        methodLookupCacheByFileAndProperty: new Map<string, any[]>(),
        methodsByFileCache: new Map<string, any[]>(),
        stats: {
            incomingLookupCalls: 0,
            incomingDirectScanMs: 0,
            incomingIndexBuildMs: 0,
            incomingIndexBuilt: false,
            methodLookupCalls: 0,
            methodLookupCacheHits: 0,
        },
    };

    const siteIdsByTriggerNodeId = new Map<number, number[]>();
    const sites: SyntheticInvokeLazySite[] = [];
    const eagerSiteIds = new Set<number>();
    let siteId = 0;

    for (const caller of scene.getMethods()) {
        assertBuildStageBudget(budget, "synthetic_invoke_lazy.methods");
        const cfg = caller.getCfg();
        if (!cfg) continue;

        for (const stmt of cfg.getStmts()) {
            assertBuildStageBudget(budget, "synthetic_invoke_lazy.statements");
            if (!stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!invokeExpr) continue;

            const site: SyntheticInvokeLazySite = { id: siteId++, caller, stmt, invokeExpr };
            sites.push(site);
            const resolvedBindings = collectResolvedCallbackBindingsForStmt(
                scene,
                cg,
                caller,
                stmt,
                invokeExpr,
                invokedParamCache
            );
            assertBuildStageBudget(budget, "synthetic_invoke_lazy.resolved_bindings");
            const triggerNodeIds = collectSyntheticInvokeTriggerNodeIds(
                    scene,
                    cg,
                pag,
                    caller,
                stmt,
                    invokeExpr,
                invokedParamCache,
                lookupContext,
                resolvedBindings,
            );
            for (const nodeId of triggerNodeIds) {
                if (!siteIdsByTriggerNodeId.has(nodeId)) {
                    siteIdsByTriggerNodeId.set(nodeId, []);
                }
                siteIdsByTriggerNodeId.get(nodeId)!.push(site.id);
            }
            if (triggerNodeIds.size === 0 || resolvedBindings.length > 0) {
                eagerSiteIds.add(site.id);
            }
        }
    }

    return {
        siteIdsByTriggerNodeId,
        sites,
        siteById: new Map<number, SyntheticInvokeLazySite>(sites.map(site => [site.id, site])),
        materializedSiteIds: new Set<number>(),
        eagerSiteIds,
        eagerSitesMaterialized: false,
        invokedParamCache,
        lookupContext,
    };
}

export function materializeSyntheticInvokeSitesForNode(
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    edgeMap: Map<number, SyntheticInvokeEdgeInfo[]>,
    lazy: SyntheticInvokeLazyMaterializer,
    nodeId: number,
    excludedDeferredSiteKeys?: ReadonlySet<string>,
    forceDirectCallerSignatures?: ReadonlySet<string>,
    budget?: BuildStageBudget,
): { callCount: number; returnCount: number; fallbackCalleeCount: number } {
    const siteIds = lazy.siteIdsByTriggerNodeId.get(nodeId) || [];
    let callCount = 0;
    let returnCount = 0;
    let fallbackCalleeCount = 0;

    for (const siteId of siteIds) {
        assertBuildStageBudget(budget, `synthetic_invoke_materialize.node_site(site=${siteId})`);
        if (lazy.materializedSiteIds.has(siteId)) continue;
        lazy.materializedSiteIds.add(siteId);
        const site = lazy.siteById.get(siteId);
        if (!site) continue;
        const stats = materializeSyntheticInvokeSite(scene, cg, pag, edgeMap, lazy, site, excludedDeferredSiteKeys, forceDirectCallerSignatures, budget);
        callCount += stats.callCount;
        returnCount += stats.returnCount;
        fallbackCalleeCount += stats.fallbackCalleeCount;
    }

    return { callCount, returnCount, fallbackCalleeCount };
}

export function materializeEagerSyntheticInvokeSites(
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    edgeMap: Map<number, SyntheticInvokeEdgeInfo[]>,
    lazy: SyntheticInvokeLazyMaterializer,
    excludedDeferredSiteKeys?: ReadonlySet<string>,
    forceDirectCallerSignatures?: ReadonlySet<string>,
    budget?: BuildStageBudget,
): { callCount: number; returnCount: number; fallbackCalleeCount: number } {
    if (lazy.eagerSitesMaterialized) {
        return { callCount: 0, returnCount: 0, fallbackCalleeCount: 0 };
    }
    lazy.eagerSitesMaterialized = true;

    let callCount = 0;
    let returnCount = 0;
    let fallbackCalleeCount = 0;
    for (const siteId of lazy.eagerSiteIds) {
        assertBuildStageBudget(budget, `synthetic_invoke_materialize.eager_site(site=${siteId})`);
        if (lazy.materializedSiteIds.has(siteId)) continue;
        lazy.materializedSiteIds.add(siteId);
        const site = lazy.siteById.get(siteId);
        if (!site) continue;
        const stats = materializeSyntheticInvokeSite(scene, cg, pag, edgeMap, lazy, site, excludedDeferredSiteKeys, forceDirectCallerSignatures, budget);
        callCount += stats.callCount;
        returnCount += stats.returnCount;
        fallbackCalleeCount += stats.fallbackCalleeCount;
    }
    return { callCount, returnCount, fallbackCalleeCount };
}

export function materializeAllSyntheticInvokeSites(
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    edgeMap: Map<number, SyntheticInvokeEdgeInfo[]>,
    lazy: SyntheticInvokeLazyMaterializer,
    excludedDeferredSiteKeys?: ReadonlySet<string>,
    forceDirectCallerSignatures?: ReadonlySet<string>,
    budget?: BuildStageBudget,
): void {
    lazy.eagerSitesMaterialized = true;
    for (const site of lazy.sites) {
        assertBuildStageBudget(budget, `synthetic_invoke_materialize.all_site(site=${site.id})`);
        if (lazy.materializedSiteIds.has(site.id)) continue;
        lazy.materializedSiteIds.add(site.id);
        materializeSyntheticInvokeSite(scene, cg, pag, edgeMap, lazy, site, excludedDeferredSiteKeys, forceDirectCallerSignatures, budget);
    }
}

function pushEdge(map: Map<number, SyntheticInvokeEdgeInfo[]>, key: number, edge: SyntheticInvokeEdgeInfo): void {
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(edge);
}

function simpleHash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h) + s.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h % 10000);
}

function isUnknownInvokeSignature(invokeExpr: any): boolean {
    const sig = invokeExpr?.getMethodSignature?.()?.toString?.() || "";
    return sig.includes("%unk");
}

function collectSyntheticInvokeTriggerNodeIds(
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    caller: any,
    stmt: any,
    invokeExpr: any,
    invokedParamCache: Map<string, Set<number>>,
    lookupContext: SyntheticInvokeLookupContext,
    resolvedBindings?: AsyncCallbackBinding[],
): Set<number> {
    const triggerNodeIds = new Set<number>();
    const addTriggerNodesForValue = (value: any): void => {
        for (const nodeId of safeGetOrCreatePagNodes(pag, value, stmt)?.values?.() || []) {
            triggerNodeIds.add(nodeId);
            for (const objId of collectPointToNodeIds(pag, [nodeId])) {
                triggerNodeIds.add(objId);
            }
        }
        for (const carrierNodeId of collectCarrierNodeIdsForValueAtStmt(pag, value, stmt)) {
            triggerNodeIds.add(carrierNodeId);
        }
    };
    const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    for (const arg of args) {
        addTriggerNodesForValue(arg);
    }
    const base = invokeExpr.getBase?.();
    if (base) {
        addTriggerNodesForValue(base);
    }

    const resolvedTargets = collectResolvedInvokeTargets(scene, cg, stmt, invokeExpr);
    for (const callee of resolvedTargets) {
        const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        const paramStmts = collectParameterAssignStmts(callee);
        for (const pair of mapInvokeArgsToParamAssigns(invokeExpr, explicitArgs, paramStmts)) {
            addTriggerNodesForValue(pair.arg);
        }
    }

    const callbackBindings = resolvedBindings || collectResolvedCallbackBindingsForStmt(
        scene,
        cg,
        caller,
        stmt,
        invokeExpr,
        invokedParamCache
    );
    for (const binding of callbackBindings) {
        for (const nodeId of collectCallbackBindingTriggerNodeIds(pag, stmt, binding.method, binding.sourceMethod || caller)) {
            triggerNodeIds.add(nodeId);
        }
    }

    return triggerNodeIds;
}

function collectPointToNodeIds(pag: Pag, nodeIds: Iterable<number>): Set<number> {
    const out = new Set<number>();
    for (const nodeId of nodeIds) {
        const node = pag.getNode(Number(nodeId));
        for (const objId of (node as any)?.getPointTo?.() || []) {
            out.add(Number(objId));
        }
    }
    return out;
}

export const EXCLUDE_ALL_DEFERRED_SYNTHETIC_INVOKE_SITES = "__arktaint_exclude_all_deferred_synthetic_invoke_sites__";

function materializeSyntheticInvokeSite(
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    edgeMap: Map<number, SyntheticInvokeEdgeInfo[]>,
    lazy: SyntheticInvokeLazyMaterializer,
    site: SyntheticInvokeLazySite,
    excludedDeferredSiteKeys?: ReadonlySet<string>,
    forceDirectCallerSignatures?: ReadonlySet<string>,
    budget?: BuildStageBudget,
): { callCount: number; returnCount: number; fallbackCalleeCount: number } {
    const { caller, stmt, invokeExpr } = site;
    assertBuildStageBudget(budget, `synthetic_invoke_materialize.site.start(site=${site.id})`);
    const siteKey = buildExecutionHandoffSiteKeyFromStmt(caller, stmt);
    const skipDeferredCallbacks = shouldSkipDeferredSyntheticInvokeSite(
        excludedDeferredSiteKeys,
        siteKey,
        invokeExpr,
    );
    const callCount = skipDeferredCallbacks
        ? 0
        : injectResolvedCallbackParameterEdges(
            scene,
            cg,
            pag,
            caller,
            stmt,
            invokeExpr,
            edgeMap,
            lazy.invokedParamCache
        );
    assertBuildStageBudget(budget, `synthetic_invoke_materialize.site.callback_edges_done(site=${site.id})`);

    const directStats = skipDeferredCallbacks
        ? { callCount: 0, returnCount: 0, fallbackCalleeCount: 0 }
        : materializeDirectSyntheticInvokeEdges(
            scene,
            cg,
            pag,
            caller,
            stmt,
            invokeExpr,
            edgeMap,
            lazy.lookupContext,
            forceDirectCallerSignatures,
            budget,
        );
    assertBuildStageBudget(budget, `synthetic_invoke_materialize.site.done(site=${site.id})`);

    return {
        callCount: callCount + directStats.callCount,
        returnCount: directStats.returnCount,
        fallbackCalleeCount: directStats.fallbackCalleeCount,
    };
}

function shouldSkipDeferredSyntheticInvokeSite(
    excludedDeferredSiteKeys: ReadonlySet<string> | undefined,
    siteKey: string,
    invokeExpr: any,
): boolean {
    if (!excludedDeferredSiteKeys) return false;
    if (excludedDeferredSiteKeys.has(siteKey)) return true;
    if (!excludedDeferredSiteKeys.has(EXCLUDE_ALL_DEFERRED_SYNTHETIC_INVOKE_SITES)) return false;
    const methodName = resolveInvokeMethodName(invokeExpr);
    return methodName === "then"
        || methodName === "catch"
        || methodName === "finally"
        || methodName === "on"
        || methodName === "once"
        || methodName === "addEventListener"
        || methodName === "setTimeout"
        || methodName === "setInterval";
}

function materializeDirectSyntheticInvokeEdges(
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    caller: any,
    stmt: any,
    invokeExpr: any,
    edgeMap: Map<number, SyntheticInvokeEdgeInfo[]>,
    lookupContext: SyntheticInvokeLookupContext,
    forceDirectCallerSignatures?: ReadonlySet<string>,
    budget?: BuildStageBudget,
): { callCount: number; returnCount: number; fallbackCalleeCount: number } {
    let callCount = 0;
    let returnCount = 0;
    let fallbackCalleeCount = 0;

    const callSites = cg.getCallSiteByStmt(stmt) || [];
    const forceFallback = isReflectDispatchInvoke(invokeExpr);
    const allowUnknownInvokeFallback = isUnknownInvokeSignature(invokeExpr);
    const callerSignature = caller?.getSignature?.()?.toString?.() || "";
    const forceDirectFallback = !!callerSignature && !!forceDirectCallerSignatures?.has(callerSignature);
    const repairResolvedCallSiteCopies = callSites.length > 0
        && !forceFallback
        && !allowUnknownInvokeFallback
        && !forceDirectFallback;

    assertBuildStageBudget(budget, "synthetic_invoke_materialize.direct.resolve_callees.start");
    let callees = repairResolvedCallSiteCopies
        ? collectCalleesFromCallSites(cg, callSites)
        : resolveCalleeCandidates(scene, invokeExpr);
    assertBuildStageBudget(budget, `synthetic_invoke_materialize.direct.resolve_callees.done(count=${callees.length})`);
    if (forceFallback) {
        assertBuildStageBudget(budget, "synthetic_invoke_materialize.direct.reflect_fallback.start");
        const oneHopFallback = resolveReflectDispatchOneHopFallbackCallees(
            scene,
            cg,
            caller,
            invokeExpr,
            lookupContext
        );
        if (oneHopFallback.length > 0) {
            const seen = new Set<string>();
            const merged: typeof callees = [];
            for (const item of [...callees, ...oneHopFallback]) {
                const sig = item?.method?.getSignature?.().toString?.();
                if (!sig || seen.has(sig)) continue;
                seen.add(sig);
                merged.push(item);
            }
            callees = merged;
        }
        assertBuildStageBudget(budget, `synthetic_invoke_materialize.direct.reflect_fallback.done(count=${callees.length})`);
    }
    if (callees.length === 0) {
        assertBuildStageBudget(budget, "synthetic_invoke_materialize.direct.dynamic_fallback.start");
        const dynamicPropFallback = resolveDynamicPropertyOneHopFallbackCallees(
            scene,
            cg,
            caller,
            invokeExpr,
            lookupContext
        );
        if (dynamicPropFallback.length > 0) {
            callees = dynamicPropFallback;
        }
        assertBuildStageBudget(budget, `synthetic_invoke_materialize.direct.dynamic_fallback.done(count=${callees.length})`);
    }
    if (callees.length === 0) {
        return { callCount, returnCount, fallbackCalleeCount };
    }

    for (const resolved of callees) {
        assertBuildStageBudget(budget, `synthetic_invoke_materialize.direct.callee.start(count=${callees.length})`);
        const callee = resolved.method;
        if (!callee || !callee.getCfg()) continue;
        if (resolved.reason !== "exact") {
            fallbackCalleeCount++;
        }

        const calleeSig = callee.getSignature().toString();
        const callSiteId = stmt.getOriginPositionInfo().getLineNo() * 10000 + simpleHash(calleeSig);
        const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        const paramStmts = collectParameterAssignStmts(callee);
        const pairs = mapInvokeArgsToParamAssigns(invokeExpr, explicitArgs, paramStmts);

        for (const pair of pairs) {
            assertBuildStageBudget(budget, "synthetic_invoke_materialize.direct.param_pair");
            const arg = pair.arg;
            const paramStmt = pair.paramStmt;
            const srcNodes = pag.getNodesByValue(arg) || safeGetOrCreatePagNodes(pag, arg, stmt);

            let dstNodes = pag.getNodesByValue(paramStmt.getLeftOp());
            if (!dstNodes || dstNodes.size === 0) {
                dstNodes = pag.getNodesByValue(paramStmt.getRightOp());
            }
            if (!dstNodes || dstNodes.size === 0) {
                dstNodes = safeGetOrCreatePagNodes(pag, paramStmt.getLeftOp(), paramStmt);
            }
            if (!srcNodes || !dstNodes) continue;

            for (const srcNodeId of srcNodes.values()) {
                for (const dstNodeId of dstNodes.values()) {
                    if (repairResolvedCallSiteCopies && hasPagCopyEdge(pag, srcNodeId, dstNodeId)) {
                        continue;
                    }
                    pushEdge(edgeMap, srcNodeId, {
                        type: CallEdgeType.CALL,
                        srcNodeId,
                        dstNodeId,
                        callSiteId,
                        callerMethodName: caller.getName(),
                        calleeMethodName: callee.getName(),
                        callerSignature: caller.getSignature?.().toString?.(),
                        calleeSignature: calleeSig,
                        originTag: repairResolvedCallSiteCopies ? "resolved_callsite_missing_pag_copy" : "synthetic_invoke",
                        preserveFieldPath: true,
                    });
                    callCount++;
                }
            }
        }

        if (!(stmt instanceof ArkAssignStmt)) continue;

        const retDst = stmt.getLeftOp();
        const retStmts = callee.getReturnStmt();
        for (const retStmt of retStmts) {
            assertBuildStageBudget(budget, "synthetic_invoke_materialize.direct.return_pair");
            const retValue = (retStmt as ArkReturnStmt).getOp();
            if (!(retValue instanceof Local)) continue;

            const srcNodes = pag.getNodesByValue(retValue);
            const dstNodes = pag.getNodesByValue(retDst);
            if (!srcNodes || !dstNodes) continue;

            for (const srcNodeId of srcNodes.values()) {
                for (const dstNodeId of dstNodes.values()) {
                    if (repairResolvedCallSiteCopies && hasPagCopyEdge(pag, srcNodeId, dstNodeId)) {
                        continue;
                    }
                    pushEdge(edgeMap, srcNodeId, {
                        type: CallEdgeType.RETURN,
                        srcNodeId,
                        dstNodeId,
                        callSiteId,
                        callerMethodName: caller.getName(),
                        calleeMethodName: callee.getName(),
                        callerSignature: caller.getSignature?.().toString?.(),
                        calleeSignature: calleeSig,
                        originTag: repairResolvedCallSiteCopies ? "resolved_callsite_missing_pag_copy" : "synthetic_invoke",
                        preserveFieldPath: true,
                    });
                    returnCount++;
                }
            }
        }
    }

    return { callCount, returnCount, fallbackCalleeCount };
}

function collectCalleesFromCallSites(
    cg: CallGraph,
    callSites: any[],
): Array<{ method: any; reason: "exact" }> {
    const out: Array<{ method: any; reason: "exact" }> = [];
    const seen = new Set<string>();
    for (const cs of callSites) {
        const calleeFuncID = cs.getCalleeFuncID?.();
        if (!calleeFuncID) continue;
        const method = cg.getArkMethodByFuncID(calleeFuncID);
        const sig = method?.getSignature?.()?.toString?.();
        if (!method?.getCfg?.() || !sig || seen.has(sig)) continue;
        seen.add(sig);
        out.push({ method, reason: "exact" });
    }
    return out;
}

function hasPagCopyEdge(pag: Pag, srcNodeId: number, dstNodeId: number): boolean {
    const srcNode = pag.getNode(srcNodeId) as PagNode;
    const copyEdges = srcNode?.getOutgoingCopyEdges?.()?.values?.();
    if (!copyEdges) return false;
    for (const edge of copyEdges) {
        if (edge.getDstID?.() === dstNodeId) {
            return true;
        }
    }
    return false;
}

