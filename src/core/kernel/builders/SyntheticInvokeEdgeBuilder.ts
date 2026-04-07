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
} from "../../substrate/queries/CalleeResolver";
import { getMethodBySignature } from "../contracts/MethodLookup";
import { safeGetOrCreatePagNodes } from "../contracts/PagNodeResolution";
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
}

export interface SyntheticConstructorStoreInfo {
    srcNodeId: number;
    objId: number;
    fieldName: string;
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
        const stats = materializeSyntheticInvokeSite(scene, cg, pag, edgeMap, lazy, site, excludedDeferredSiteKeys);
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
    _log: (msg: string) => void
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
        const cfg = caller.getCfg();
        if (!cfg) continue;

        for (const stmt of cfg.getStmts()) {
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
): { callCount: number; returnCount: number; fallbackCalleeCount: number } {
    const siteIds = lazy.siteIdsByTriggerNodeId.get(nodeId) || [];
    let callCount = 0;
    let returnCount = 0;
    let fallbackCalleeCount = 0;

    for (const siteId of siteIds) {
        if (lazy.materializedSiteIds.has(siteId)) continue;
        lazy.materializedSiteIds.add(siteId);
        const site = lazy.siteById.get(siteId);
        if (!site) continue;
        const stats = materializeSyntheticInvokeSite(scene, cg, pag, edgeMap, lazy, site, excludedDeferredSiteKeys);
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
): { callCount: number; returnCount: number; fallbackCalleeCount: number } {
    if (lazy.eagerSitesMaterialized) {
        return { callCount: 0, returnCount: 0, fallbackCalleeCount: 0 };
    }
    lazy.eagerSitesMaterialized = true;

    let callCount = 0;
    let returnCount = 0;
    let fallbackCalleeCount = 0;
    for (const siteId of lazy.eagerSiteIds) {
        if (lazy.materializedSiteIds.has(siteId)) continue;
        lazy.materializedSiteIds.add(siteId);
        const site = lazy.siteById.get(siteId);
        if (!site) continue;
        const stats = materializeSyntheticInvokeSite(scene, cg, pag, edgeMap, lazy, site, excludedDeferredSiteKeys);
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
): void {
    lazy.eagerSitesMaterialized = true;
    for (const site of lazy.sites) {
        if (lazy.materializedSiteIds.has(site.id)) continue;
        lazy.materializedSiteIds.add(site.id);
        materializeSyntheticInvokeSite(scene, cg, pag, edgeMap, lazy, site, excludedDeferredSiteKeys);
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
    const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    for (const arg of args) {
        for (const nodeId of safeGetOrCreatePagNodes(pag, arg, stmt)?.values?.() || []) {
            triggerNodeIds.add(nodeId);
        }
    }
    const base = invokeExpr.getBase?.();
    if (base) {
        for (const nodeId of safeGetOrCreatePagNodes(pag, base, stmt)?.values?.() || []) {
            triggerNodeIds.add(nodeId);
        }
    }

    const resolvedTargets = collectResolvedInvokeTargets(scene, cg, stmt, invokeExpr);
    for (const callee of resolvedTargets) {
        const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        const paramStmts = collectParameterAssignStmts(callee);
        for (const pair of mapInvokeArgsToParamAssigns(invokeExpr, explicitArgs, paramStmts)) {
            for (const nodeId of safeGetOrCreatePagNodes(pag, pair.arg, stmt)?.values?.() || []) {
                triggerNodeIds.add(nodeId);
            }
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

function materializeSyntheticInvokeSite(
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    edgeMap: Map<number, SyntheticInvokeEdgeInfo[]>,
    lazy: SyntheticInvokeLazyMaterializer,
    site: SyntheticInvokeLazySite,
    excludedDeferredSiteKeys?: ReadonlySet<string>,
): { callCount: number; returnCount: number; fallbackCalleeCount: number } {
    const { caller, stmt, invokeExpr } = site;
    const siteKey = buildExecutionHandoffSiteKeyFromStmt(caller, stmt);
    const skipDeferredCallbacks = excludedDeferredSiteKeys?.has(siteKey) || false;
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
            lazy.lookupContext
        );

    return {
        callCount: callCount + directStats.callCount,
        returnCount: directStats.returnCount,
        fallbackCalleeCount: directStats.fallbackCalleeCount,
    };
}

function materializeDirectSyntheticInvokeEdges(
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    caller: any,
    stmt: any,
    invokeExpr: any,
    edgeMap: Map<number, SyntheticInvokeEdgeInfo[]>,
    lookupContext: SyntheticInvokeLookupContext
): { callCount: number; returnCount: number; fallbackCalleeCount: number } {
    let callCount = 0;
    let returnCount = 0;
    let fallbackCalleeCount = 0;

    const callSites = cg.getCallSiteByStmt(stmt) || [];
    const forceFallback = isReflectDispatchInvoke(invokeExpr);
    const allowUnknownInvokeFallback = isUnknownInvokeSignature(invokeExpr);
    if (callSites.length > 0 && !forceFallback && !allowUnknownInvokeFallback) {
        return { callCount, returnCount, fallbackCalleeCount };
    }

    let callees = resolveCalleeCandidates(scene, invokeExpr);
    if (forceFallback) {
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
    }
    if (callees.length === 0) {
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
    }
    if (callees.length === 0) {
        return { callCount, returnCount, fallbackCalleeCount };
    }

    for (const resolved of callees) {
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
            const arg = pair.arg;
            const paramStmt = pair.paramStmt;
            const srcNodes = pag.getNodesByValue(arg);

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
                    pushEdge(edgeMap, srcNodeId, {
                        type: CallEdgeType.CALL,
                        srcNodeId,
                        dstNodeId,
                        callSiteId,
                        callerMethodName: caller.getName(),
                        calleeMethodName: callee.getName(),
                        callerSignature: caller.getSignature?.().toString?.(),
                        calleeSignature: calleeSig,
                    });
                    callCount++;
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
                        callerSignature: caller.getSignature?.().toString?.(),
                        calleeSignature: calleeSig,
                    });
                    returnCount++;
                }
            }
        }
    }

    return { callCount, returnCount, fallbackCalleeCount };
}

