import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { CallGraph } from "../../../../arkanalyzer/out/src/callgraph/model/CallGraph";
import { Pag, PagArrayNode, PagInstanceFieldNode, PagNode, PagStaticFieldNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
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
    ArkAwaitExpr,
    ArkCastExpr,
    ArkNewArrayExpr,
    ArkNewExpr,
    ArkStaticInvokeExpr,
} from "../../../../arkanalyzer/out/src/core/base/Expr";
import { CallEdgeType } from "../context/TaintContext";
import {
    buildMethodThisOwnerContextIndex,
    collectParameterAssignStmts,
    diagnoseUnresolvedVirtualDispatch,
    isReflectDispatchInvoke,
    mapInvokeArgsToParamAssigns,
    resolveCalleeCandidates,
    resolveInvokeMethodName,
} from "../../substrate/queries/CalleeResolver";
import { getMethodBySignature } from "../contracts/MethodLookup";
import {
    isBuildablePagValue,
    materializeExactPagNodes,
    resolveExistingPagNodes,
} from "../contracts/PagNodeResolution";
import { collectCarrierNodeIdsForValueAtStmt } from "../ordinary/OrdinaryAliasPropagation";
import {
    collectCallbackBindingTriggerNodeIds,
    collectResolvedInvokeTargets,
    collectResolvedInvokeTargetsCached,
    collectResolvedCallbackBindingsForStmt,
    injectResolvedCallbackParameterEdges,
    type AsyncCallbackBinding,
    type SyntheticInvokeLookupContext,
    type SyntheticInvokeLookupStats,
} from "./SyntheticInvokeCallbacks";
import { buildExecutionHandoffSiteKeyFromStmt } from "../handoff/ExecutionHandoffSiteKey";
import { assertBuildStageBudget, BuildStageBudget } from "../../shared/BuildStageBudget";
export {
    buildSyntheticConstructorStoreMap,
    collectDynamicSyntheticConstructorStores,
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
    receiverOwnerName?: string;
}

export type CallEdgeMaterializationKind =
    | "arg_to_param"
    | "this_to_callee_this"
    | "return_to_assignment"
    | "await_unwrap"
    | "callback_registration"
    | "synthetic_edge"
    | "virtual_dispatch";

export type CallEdgeMaterializationStatus =
    | "built"
    | "not_built"
    | "not_applicable"
    | "skipped"
    | "ambiguous";

export interface CallEdgeMaterializationLedgerRecord {
    recordKind: "call_edge_materialization";
    builder: "call_edge_map" | "synthetic_invoke";
    edgeKind: CallEdgeMaterializationKind;
    status: CallEdgeMaterializationStatus;
    reason?: string;
    callerMethodName?: string;
    calleeMethodName?: string;
    callerSignature?: string;
    calleeSignature?: string;
    callbackSignature?: string;
    callbackSourceSignature?: string;
    line?: number;
    stmtText?: string;
    argIndex?: number;
    paramIndex?: number;
    srcNodeIds?: number[];
    dstNodeIds?: number[];
    builtEdgeCount: number;
    syntheticEdgeBuilt: boolean;
    calleeResolveReason?: string;
    candidateCount?: number;
    evidence?: string[];
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
    pathMode: "replace_source_head" | "append_source_path";
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
    siteIdsByCallerSignature: Map<string, number[]>;
    sites: SyntheticInvokeLazySite[];
    siteById: Map<number, SyntheticInvokeLazySite>;
    materializedSiteIds: Set<number>;
    eagerSiteIds: Set<number>;
    eagerSitesMaterialized: boolean;
    invokedParamCache: Map<string, Set<number>>;
    lookupContext: SyntheticInvokeLookupContext;
    materializationLedger: CallEdgeMaterializationLedgerRecord[];
}

export function buildSyntheticInvokeEdges(
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    log: (msg: string) => void,
    excludedDeferredSiteKeys?: ReadonlySet<string>,
    forceDirectCallerSignatures?: ReadonlySet<string>,
    materializationLedger: CallEdgeMaterializationLedgerRecord[] = [],
): Map<number, SyntheticInvokeEdgeInfo[]> {
    // Deferred/future execution edges are emitted by algorithm D.
    // This builder only materializes synthetic invoke edges for synchronous invoke recovery.
    const buildStartMs = Date.now();
    const edgeMap = new Map<number, SyntheticInvokeEdgeInfo[]>();
    let syntheticCallCount = 0;
    let syntheticReturnCount = 0;
    let nonExactCalleeCount = 0;
    const lazy = buildSyntheticInvokeLazyMaterializer(scene, cg, pag, log, undefined, materializationLedger);

    for (const site of lazy.sites) {
        const stats = materializeSyntheticInvokeSite(scene, cg, pag, edgeMap, lazy, site, excludedDeferredSiteKeys, forceDirectCallerSignatures);
        syntheticCallCount += stats.callCount;
        syntheticReturnCount += stats.returnCount;
        nonExactCalleeCount += stats.nonExactCalleeCount;
    }

    const totalMs = Date.now() - buildStartMs;
    const lookupMs = lazy.lookupContext.stats.incomingDirectScanMs + lazy.lookupContext.stats.incomingIndexBuildMs;
    const lookupRatio = totalMs > 0 ? ((lookupMs * 100) / totalMs) : 0;
    log(`Synthetic Invoke Edge Map Built: ${syntheticCallCount} call edges, ${syntheticReturnCount} return edges, ${nonExactCalleeCount} non-exact callees.`);
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
    materializationLedger: CallEdgeMaterializationLedgerRecord[] = [],
): SyntheticInvokeLazyMaterializer {
    const methodsWithInvokeSites = collectMethodsWithInvokeSites(scene, budget);
    const invokedParamCache = new Map<string, Set<number>>();
    const lookupContext: SyntheticInvokeLookupContext = {
        thisOwnerNamesByMethodSignature: buildMethodThisOwnerContextIndex(scene, methodsWithInvokeSites, {
            budget,
            log: _log,
        }),
        methodLookupCacheByFileAndProperty: new Map<string, any[]>(),
        methodsByFileCache: new Map<string, any[]>(),
        resolvedInvokeTargetsByStmt: new WeakMap<object, any[]>(),
        controllerOptionRegistrationsByStmt: new WeakMap<object, any[]>(),
        storedReceiverFieldCallbackBindingsByStmt: new WeakMap<object, AsyncCallbackBinding[]>(),
        callbackMethodsByArgCallable: new WeakMap<object, any[]>(),
        callbackMethodsByArgSdk: new WeakMap<object, any[]>(),
        stats: {
            incomingLookupCalls: 0,
            incomingDirectScanMs: 0,
            incomingIndexBuildMs: 0,
            incomingIndexBuilt: false,
            methodLookupCalls: 0,
            methodLookupCacheHits: 0,
            resolvedInvokeTargetCalls: 0,
            resolvedInvokeTargetCacheHits: 0,
            controllerOptionRegistrationCalls: 0,
            controllerOptionRegistrationCacheHits: 0,
            storedReceiverFieldCallbackCalls: 0,
            storedReceiverFieldCallbackCacheHits: 0,
            callbackArgMethodCalls: 0,
            callbackArgMethodCacheHits: 0,
        },
    };

    const siteIdsByTriggerNodeId = new Map<number, number[]>();
    const siteIdsByCallerSignature = new Map<string, number[]>();
    const sites: SyntheticInvokeLazySite[] = [];
    const eagerSiteIds = new Set<number>();
    let siteId = 0;

    for (const caller of methodsWithInvokeSites) {
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
            const callerSignature = safeMethodSignatureText(caller);
            if (callerSignature) {
                if (!siteIdsByCallerSignature.has(callerSignature)) {
                    siteIdsByCallerSignature.set(callerSignature, []);
                }
                siteIdsByCallerSignature.get(callerSignature)!.push(site.id);
            }
            const resolvedBindings = collectResolvedCallbackBindingsForStmt(
                scene,
                cg,
                caller,
                stmt,
                invokeExpr,
                invokedParamCache,
                lookupContext,
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
        siteIdsByCallerSignature,
        sites,
        siteById: new Map<number, SyntheticInvokeLazySite>(sites.map(site => [site.id, site])),
        materializedSiteIds: new Set<number>(),
        eagerSiteIds,
        eagerSitesMaterialized: false,
        invokedParamCache,
        lookupContext,
        materializationLedger,
    };
}

function collectMethodsWithInvokeSites(
    scene: Scene,
    budget?: BuildStageBudget,
): any[] {
    const out: any[] = [];
    for (const method of scene.getMethods()) {
        assertBuildStageBudget(budget, "synthetic_invoke_lazy.collect_methods");
        const cfg = method?.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts?.() || []) {
            assertBuildStageBudget(budget, "synthetic_invoke_lazy.collect_statements");
            if (!stmt?.containsInvokeExpr?.()) continue;
            out.push(method);
            break;
        }
    }
    return out;
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
): { callCount: number; returnCount: number; nonExactCalleeCount: number } {
    const siteIds = lazy.siteIdsByTriggerNodeId.get(nodeId) || [];
    let callCount = 0;
    let returnCount = 0;
    let nonExactCalleeCount = 0;

    for (const siteId of siteIds) {
        assertBuildStageBudget(budget, `synthetic_invoke_materialize.node_site(site=${siteId})`);
        if (lazy.materializedSiteIds.has(siteId)) continue;
        lazy.materializedSiteIds.add(siteId);
        const site = lazy.siteById.get(siteId);
        if (!site) continue;
        const stats = materializeSyntheticInvokeSite(scene, cg, pag, edgeMap, lazy, site, excludedDeferredSiteKeys, forceDirectCallerSignatures, budget);
        callCount += stats.callCount;
        returnCount += stats.returnCount;
        nonExactCalleeCount += stats.nonExactCalleeCount;
    }

    return { callCount, returnCount, nonExactCalleeCount };
}

export function materializeSyntheticInvokeSitesForCaller(
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    edgeMap: Map<number, SyntheticInvokeEdgeInfo[]>,
    lazy: SyntheticInvokeLazyMaterializer,
    callerSignature: string,
    excludedDeferredSiteKeys?: ReadonlySet<string>,
    forceDirectCallerSignatures?: ReadonlySet<string>,
    budget?: BuildStageBudget,
): { callCount: number; returnCount: number; nonExactCalleeCount: number } {
    const siteIds = lazy.siteIdsByCallerSignature.get(callerSignature) || [];
    let callCount = 0;
    let returnCount = 0;
    let nonExactCalleeCount = 0;

    for (const siteId of siteIds) {
        assertBuildStageBudget(budget, `synthetic_invoke_materialize.caller_site(site=${siteId})`);
        if (lazy.materializedSiteIds.has(siteId)) continue;
        lazy.materializedSiteIds.add(siteId);
        const site = lazy.siteById.get(siteId);
        if (!site) continue;
        const stats = materializeSyntheticInvokeSite(scene, cg, pag, edgeMap, lazy, site, excludedDeferredSiteKeys, forceDirectCallerSignatures, budget);
        callCount += stats.callCount;
        returnCount += stats.returnCount;
        nonExactCalleeCount += stats.nonExactCalleeCount;
    }

    return { callCount, returnCount, nonExactCalleeCount };
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
): { callCount: number; returnCount: number; nonExactCalleeCount: number } {
    if (lazy.eagerSitesMaterialized) {
        return { callCount: 0, returnCount: 0, nonExactCalleeCount: 0 };
    }
    lazy.eagerSitesMaterialized = true;

    let callCount = 0;
    let returnCount = 0;
    let nonExactCalleeCount = 0;
    for (const siteId of lazy.eagerSiteIds) {
        assertBuildStageBudget(budget, `synthetic_invoke_materialize.eager_site(site=${siteId})`);
        if (lazy.materializedSiteIds.has(siteId)) continue;
        lazy.materializedSiteIds.add(siteId);
        const site = lazy.siteById.get(siteId);
        if (!site) continue;
        const stats = materializeSyntheticInvokeSite(scene, cg, pag, edgeMap, lazy, site, excludedDeferredSiteKeys, forceDirectCallerSignatures, budget);
        callCount += stats.callCount;
        returnCount += stats.returnCount;
        nonExactCalleeCount += stats.nonExactCalleeCount;
    }
    return { callCount, returnCount, nonExactCalleeCount };
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

function safeMethodSignatureText(method: any): string {
    return method?.getSignature?.()?.toString?.() || "";
}

function pushMaterializationRecord(
    ledger: CallEdgeMaterializationLedgerRecord[] | undefined,
    record: Omit<CallEdgeMaterializationLedgerRecord, "recordKind" | "builder" | "syntheticEdgeBuilt"> & {
        builder?: "call_edge_map" | "synthetic_invoke";
        syntheticEdgeBuilt?: boolean;
    },
): void {
    if (!ledger) return;
    ledger.push({
        ...record,
        recordKind: "call_edge_materialization",
        builder: record.builder || "synthetic_invoke",
        syntheticEdgeBuilt: record.syntheticEdgeBuilt ?? record.status === "built",
    });
}

function baseMaterializationSite(caller: any, stmt: any, invokeExpr: any, callee?: any): {
    callerMethodName: string;
    calleeMethodName?: string;
    callerSignature?: string;
    calleeSignature?: string;
    line: number;
    stmtText: string;
} {
    return {
        callerMethodName: caller?.getName?.() || "",
        calleeMethodName: callee?.getName?.(),
        callerSignature: caller?.getSignature?.()?.toString?.(),
        calleeSignature: callee?.getSignature?.()?.toString?.() || invokeExpr?.getMethodSignature?.()?.toString?.(),
        line: stmt?.getOriginPositionInfo?.()?.getLineNo?.() ?? -1,
        stmtText: stmt?.toString?.() || "",
    };
}

function nodeIdArray(nodes: Map<number, number> | undefined): number[] {
    return nodes ? [...nodes.values()].map(Number).sort((a, b) => a - b) : [];
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
        for (const nodeId of resolveExistingPagNodes(pag, value, stmt)?.values?.() || []) {
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

    const resolvedTargets = collectResolvedInvokeTargetsCached(scene, cg, stmt, invokeExpr, lookupContext);
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
        invokedParamCache,
        lookupContext,
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

function shouldMaterializeResolvedCalleeEndpoint(reason: string): boolean {
    return reason === "exact"
        || reason === "interface_dispatch"
        || reason === "receiver_owner_dispatch"
        || reason === "callable_dispatch";
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
): { callCount: number; returnCount: number; nonExactCalleeCount: number } {
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
            lazy.invokedParamCache,
            lazy.materializationLedger,
            lazy.lookupContext,
        );
    assertBuildStageBudget(budget, `synthetic_invoke_materialize.site.callback_edges_done(site=${site.id})`);

    const directStats = skipDeferredCallbacks
        ? { callCount: 0, returnCount: 0, nonExactCalleeCount: 0 }
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
            lazy.materializationLedger,
        );
    assertBuildStageBudget(budget, `synthetic_invoke_materialize.site.done(site=${site.id})`);

    return {
        callCount: callCount + directStats.callCount,
        returnCount: directStats.returnCount,
        nonExactCalleeCount: directStats.nonExactCalleeCount,
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

function resolveCalleesWithThisOwnerContexts(
    scene: Scene,
    invokeExpr: any,
    callerSignature: string,
    lookupContext: SyntheticInvokeLookupContext,
): Array<{ method: any; reason: "exact" | "interface_dispatch" | "receiver_owner_dispatch" | "callable_dispatch"; receiverOwnerName?: string }> {
    const ownerNames = callerSignature
        ? [...(lookupContext.thisOwnerNamesByMethodSignature?.get(callerSignature) || [])].sort()
        : [];
    const contexts = ownerNames.length > 0 ? ownerNames : [undefined];
    const out = new Map<string, { method: any; reason: "exact" | "interface_dispatch" | "receiver_owner_dispatch" | "callable_dispatch"; receiverOwnerName?: string }>();
    for (const ownerName of contexts) {
        const resolvedCallees = resolveCalleeCandidates(scene, invokeExpr, ownerName ? { thisOwnerNames: [ownerName] } : {});
        for (const resolved of resolvedCallees) {
            const signature = resolved.method?.getSignature?.()?.toString?.();
            if (!signature) continue;
            const key = `${ownerName || ""}\u0001${signature}`;
            if (out.has(key)) continue;
            out.set(key, { ...resolved, receiverOwnerName: ownerName });
        }
    }
    return [...out.values()];
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
    materializationLedger: CallEdgeMaterializationLedgerRecord[] = [],
): { callCount: number; returnCount: number; nonExactCalleeCount: number } {
    let callCount = 0;
    let returnCount = 0;
    let nonExactCalleeCount = 0;

    const callSites = cg.getCallSiteByStmt(stmt) || [];
    const callerSignature = caller?.getSignature?.()?.toString?.() || "";
    const forceDirectResolve = !!callerSignature && !!forceDirectCallerSignatures?.has(callerSignature);
    const repairResolvedCallSiteCopies = callSites.length > 0
        && !isReflectDispatchInvoke(invokeExpr)
        && !isUnknownInvokeSignature(invokeExpr)
        && !forceDirectResolve;

    assertBuildStageBudget(budget, "synthetic_invoke_materialize.direct.resolve_callees.start");
    let callees = repairResolvedCallSiteCopies
        ? collectCalleesFromCallSites(cg, callSites)
        : resolveCalleesWithThisOwnerContexts(scene, invokeExpr, callerSignature, lookupContext);
    if (repairResolvedCallSiteCopies && callees.length === 0) {
        callees = resolveCalleesWithThisOwnerContexts(scene, invokeExpr, callerSignature, lookupContext);
    }
    assertBuildStageBudget(budget, `synthetic_invoke_materialize.direct.resolve_callees.done(count=${callees.length})`);
    if (callees.length === 0) {
        const diagnostic = diagnoseUnresolvedVirtualDispatch(scene, invokeExpr);
        pushMaterializationRecord(materializationLedger, {
            ...baseMaterializationSite(caller, stmt, invokeExpr),
            edgeKind: "synthetic_edge",
            status: "not_built",
            reason: diagnostic?.reasonCode || "no_resolved_callee",
            builtEdgeCount: 0,
            candidateCount: diagnostic?.candidateCount,
            evidence: diagnostic?.evidence,
        });
        return { callCount, returnCount, nonExactCalleeCount };
    }

    for (const resolved of callees) {
        assertBuildStageBudget(budget, `synthetic_invoke_materialize.direct.callee.start(count=${callees.length})`);
        const callee = resolved.method;
        if (!callee || !callee.getCfg()) continue;
        if (resolved.reason !== "exact") {
            nonExactCalleeCount++;
        }

        const calleeSig = callee.getSignature().toString();
        const receiverOwnerName = (resolved as { receiverOwnerName?: string }).receiverOwnerName;
        const callSiteId = stmt.getOriginPositionInfo().getLineNo() * 10000 + simpleHash(`${calleeSig}#owner=${receiverOwnerName || ""}`);
        const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        const paramStmts = collectParameterAssignStmts(callee);
        const pairs = mapInvokeArgsToParamAssigns(invokeExpr, explicitArgs, paramStmts);

        if (invokeExpr instanceof ArkInstanceInvokeExpr) {
            assertBuildStageBudget(budget, "synthetic_invoke_materialize.direct.receiver_this");
            const base = invokeExpr.getBase?.();
            let srcNodes = base ? (pag.getNodesByValue(base) || resolveExistingPagNodes(pag, base, stmt)) : undefined;
            if ((!srcNodes || srcNodes.size === 0) && base && shouldMaterializeResolvedCalleeEndpoint(resolved.reason)) {
                srcNodes = materializeExactPagNodes(pag, base, stmt);
            }
            const thisStmt = collectThisAssignStmt(callee);
            let builtThisEdges = 0;
            let thisDstNodes: Map<number, number> | undefined;
            if (srcNodes && thisStmt) {
                thisDstNodes = pag.getNodesByValue(thisStmt.getLeftOp());
                if (!thisDstNodes || thisDstNodes.size === 0) {
                    thisDstNodes = resolveExistingPagNodes(pag, thisStmt.getLeftOp(), thisStmt);
                }
                if ((!thisDstNodes || thisDstNodes.size === 0) && shouldMaterializeResolvedCalleeEndpoint(resolved.reason)) {
                    thisDstNodes = resolveOrCreateExactCalleeEndpointNodes(
                        pag,
                        thisStmt.getLeftOp(),
                        thisStmt,
                        srcNodes,
                    );
                }
                if (thisDstNodes && thisDstNodes.size > 0) {
                    for (const srcNodeId of srcNodes.values()) {
                        for (const dstNodeId of thisDstNodes.values()) {
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
                                originTag: repairResolvedCallSiteCopies ? "resolved_callsite_missing_pag_this_copy" : "synthetic_invoke",
                                preserveFieldPath: true,
                                receiverOwnerName,
                            });
                            builtThisEdges++;
                            callCount++;
                        }
                    }
                }
            }
            pushMaterializationRecord(materializationLedger, {
                ...baseMaterializationSite(caller, stmt, invokeExpr, callee),
                edgeKind: "this_to_callee_this",
                status: builtThisEdges > 0 ? "built" : "not_built",
                reason: builtThisEdges > 0
                    ? undefined
                    : !srcNodes
                        ? "missing_receiver_source_nodes"
                        : !thisStmt
                            ? "callee_this_assign_not_found"
                            : !thisDstNodes
                                ? "missing_callee_this_nodes"
                                : "pag_copy_edge_already_present_or_filtered",
                srcNodeIds: nodeIdArray(srcNodes),
                dstNodeIds: nodeIdArray(thisDstNodes),
                builtEdgeCount: builtThisEdges,
                calleeResolveReason: resolved.reason,
            });
        }

        for (const pair of pairs) {
            assertBuildStageBudget(budget, "synthetic_invoke_materialize.direct.param_pair");
            const arg = pair.arg;
            const paramStmt = pair.paramStmt;
            let srcNodes = pag.getNodesByValue(arg) || resolveExistingPagNodes(pag, arg, stmt);
            if ((!srcNodes || srcNodes.size === 0) && shouldMaterializeResolvedCalleeEndpoint(resolved.reason)) {
                srcNodes = materializeExactPagNodes(pag, arg, stmt);
            }

            let dstNodes = pag.getNodesByValue(paramStmt.getLeftOp());
            if (!dstNodes || dstNodes.size === 0) {
                dstNodes = pag.getNodesByValue(paramStmt.getRightOp());
            }
            if (!dstNodes || dstNodes.size === 0) {
                dstNodes = resolveExistingPagNodes(pag, paramStmt.getLeftOp(), paramStmt);
            }
            if ((!dstNodes || dstNodes.size === 0) && srcNodes && shouldMaterializeResolvedCalleeEndpoint(resolved.reason)) {
                dstNodes = resolveOrCreateExactCalleeEndpointNodes(
                    pag,
                    paramStmt.getLeftOp(),
                    paramStmt,
                    srcNodes,
                );
            }
            let builtArgEdges = 0;
            if (srcNodes && dstNodes) {
                for (const srcNodeId of srcNodes.values()) {
                    for (const dstNodeId of dstNodes.values()) {
                        if (repairResolvedCallSiteCopies && hasPagCopyEdge(pag, srcNodeId, dstNodeId)) {
                            continue;
                        }
                        const preserveArgFieldPath = canCalleeEndpointCarryNestedFieldPath(pag.getNode(dstNodeId) as PagNode | undefined);
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
                            preserveFieldPath: preserveArgFieldPath,
                            receiverOwnerName,
                        });
                        builtArgEdges++;
                        callCount++;
                    }
                }
            }
            pushMaterializationRecord(materializationLedger, {
                ...baseMaterializationSite(caller, stmt, invokeExpr, callee),
                edgeKind: "arg_to_param",
                status: builtArgEdges > 0 ? "built" : "not_built",
                reason: builtArgEdges > 0
                    ? undefined
                    : !srcNodes
                        ? "missing_arg_source_nodes"
                        : !dstNodes
                            ? "missing_param_destination_nodes"
                            : "pag_copy_edge_already_present_or_filtered",
                argIndex: pair.argIndex,
                paramIndex: pair.paramIndex,
                srcNodeIds: nodeIdArray(srcNodes),
                dstNodeIds: nodeIdArray(dstNodes),
                builtEdgeCount: builtArgEdges,
                calleeResolveReason: resolved.reason,
            });
        }

        if (!(stmt instanceof ArkAssignStmt)) continue;

        const retDst = stmt.getLeftOp();
        const retStmts = callee.getReturnStmt();
        for (const retStmt of retStmts) {
            assertBuildStageBudget(budget, "synthetic_invoke_materialize.direct.return_pair");
            const retValue = (retStmt as ArkReturnStmt).getOp();
            const returnSource = resolveSyntheticReturnValueNodes(pag, retValue, retStmt);
            const srcNodes = returnSource.nodes;
            const dstNodes = resolveExistingPagNodes(pag, retDst, stmt)
                || materializeExactPagNodes(pag, retDst, stmt);
            let builtReturnEdges = 0;
            if (srcNodes && dstNodes) {
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
                            originTag: repairResolvedCallSiteCopies ? "resolved_callsite_missing_pag_copy" : "synthetic_invoke",
                            preserveFieldPath: true,
                            receiverOwnerName,
                        });
                        builtReturnEdges++;
                        returnCount++;
                    }
                }
            }
            pushMaterializationRecord(materializationLedger, {
                ...baseMaterializationSite(caller, stmt, invokeExpr, callee),
                edgeKind: "return_to_assignment",
                status: builtReturnEdges > 0 ? "built" : "not_built",
                reason: builtReturnEdges > 0
                    ? undefined
                    : !srcNodes
                        ? "missing_return_source_nodes"
                        : !dstNodes
                            ? "missing_assignment_destination_nodes"
                            : "pag_copy_edge_already_present_or_filtered",
                srcNodeIds: nodeIdArray(srcNodes),
                dstNodeIds: nodeIdArray(dstNodes),
                builtEdgeCount: builtReturnEdges,
                calleeResolveReason: resolved.reason,
                evidence: returnSource.evidence,
            });
            if (returnSource.awaitUnwrapped) {
                pushMaterializationRecord(materializationLedger, {
                    ...baseMaterializationSite(caller, stmt, invokeExpr, callee),
                    edgeKind: "await_unwrap",
                    status: srcNodes && srcNodes.size > 0 ? "built" : "not_built",
                    reason: srcNodes && srcNodes.size > 0 ? undefined : "await_unwrap_source_nodes_missing",
                    srcNodeIds: nodeIdArray(srcNodes),
                    dstNodeIds: nodeIdArray(dstNodes),
                    builtEdgeCount: srcNodes && srcNodes.size > 0 ? builtReturnEdges : 0,
                    calleeResolveReason: resolved.reason,
                    evidence: returnSource.evidence,
                });
            }
        }
    }

    return { callCount, returnCount, nonExactCalleeCount };
}

function canCalleeEndpointCarryNestedFieldPath(node: PagNode | undefined): boolean {
    if (!node) return false;
    if (node instanceof PagArrayNode || node instanceof PagInstanceFieldNode || node instanceof PagStaticFieldNode) {
        return true;
    }
    for (const _objId of node.getPointTo?.() || []) {
        return true;
    }
    const value: any = node.getValue?.();
    const typeText = value?.getType?.()?.toString?.() || "";
    if (!typeText) return false;
    const normalized = typeText.trim();
    if (/^(string|number|boolean|bigint|symbol|null|undefined|void|any|unknown)$/i.test(normalized)) {
        return false;
    }
    if (isGenericTypeParameterCarrier(normalized)) return true;
    if (normalized.includes("%unk")) return false;
    if (/\b(Array|Map|Set|Record|Object|Promise)\b/.test(normalized)) {
        return true;
    }
    return normalized.includes("@");
}

function isGenericTypeParameterCarrier(normalizedTypeText: string): boolean {
    return /^[A-Z]$/.test(normalizedTypeText);
}

function collectThisAssignStmt(method: any): ArkAssignStmt | undefined {
    const stmts = method?.getCfg?.()?.getStmts?.() || [];
    for (const stmt of stmts) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        if (stmt.getRightOp?.() instanceof ArkThisRef) {
            return stmt;
        }
    }
    return undefined;
}

function resolveSyntheticReturnValueNodes(
    pag: Pag,
    value: any,
    anchorStmt?: any,
    visiting: Set<any> = new Set<any>(),
): { nodes?: Map<number, number>; awaitUnwrapped: boolean; evidence: string[] } {
    if (!value || visiting.has(value)) {
        return { awaitUnwrapped: false, evidence: ["return_value_unresolved"] };
    }
    visiting.add(value);
    const evidence: string[] = [];
    let awaitUnwrapped = false;
    const direct = resolveExistingPagNodes(pag, value, anchorStmt);
    if (direct && direct.size > 0) {
        visiting.delete(value);
        return { nodes: direct, awaitUnwrapped, evidence: ["direct_return_nodes"] };
    }

    if (value instanceof ArkAwaitExpr) {
        const nested = resolveSyntheticReturnValueNodes(pag, value.getPromise?.(), anchorStmt, visiting);
        awaitUnwrapped = true || nested.awaitUnwrapped;
        evidence.push("await_unwrap", ...nested.evidence);
        visiting.delete(value);
        return { nodes: nested.nodes, awaitUnwrapped, evidence };
    }
    if (value instanceof ArkCastExpr) {
        const nested = resolveSyntheticReturnValueNodes(pag, value.getOp?.(), anchorStmt, visiting);
        visiting.delete(value);
        return { ...nested, evidence: ["cast_unwrap", ...nested.evidence] };
    }
    if ((value instanceof ArkStaticInvokeExpr || value instanceof ArkInstanceInvokeExpr) && isPromiseResolveInvoke(value)) {
        const args = value.getArgs?.() || [];
        const nested = args.length > 0
            ? resolveSyntheticReturnValueNodes(pag, args[0], anchorStmt, visiting)
            : { awaitUnwrapped: false, evidence: ["promise_resolve_without_arg"] };
        visiting.delete(value);
        return { ...nested, evidence: ["promise_resolve_unwrap", ...nested.evidence] };
    }
    if (value instanceof Local) {
        const decl = value.getDeclaringStmt?.();
        if (decl instanceof ArkAssignStmt && decl.getLeftOp?.() === value) {
            const nested = resolveSyntheticReturnValueNodes(pag, decl.getRightOp?.(), decl, visiting);
            if (nested.nodes && nested.nodes.size > 0) {
                visiting.delete(value);
                return { ...nested, evidence: ["local_definition_unwrap", ...nested.evidence] };
            }
            const materializedLocal = materializeExactPagNodes(pag, value, decl);
            if (materializedLocal && materializedLocal.size > 0) {
                visiting.delete(value);
                return {
                    nodes: materializedLocal,
                    awaitUnwrapped: nested.awaitUnwrapped,
                    evidence: ["local_definition_unwrap", ...nested.evidence, "materialized_return_local_node"],
                };
            }
            visiting.delete(value);
            return { ...nested, evidence: ["local_definition_unwrap", ...nested.evidence] };
        }
    }

    const materialized = materializeExactPagNodes(pag, value, anchorStmt);
    if (materialized && materialized.size > 0) {
        visiting.delete(value);
        return { nodes: materialized, awaitUnwrapped, evidence: ["materialized_return_nodes"] };
    }

    visiting.delete(value);
    return { awaitUnwrapped, evidence: evidence.length > 0 ? evidence : ["return_value_has_no_pag_nodes"] };
}

function isPromiseResolveInvoke(value: ArkStaticInvokeExpr | ArkInstanceInvokeExpr): boolean {
    const methodName = value.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
    if (methodName !== "resolve") return false;
    const declaringClassName = value.getMethodSignature?.()?.getDeclaringClassSignature?.()?.getClassName?.() || "";
    if (declaringClassName === "Promise") return true;
    const base = value instanceof ArkInstanceInvokeExpr ? value.getBase?.() : undefined;
    if (!(base instanceof Local) || (value.getArgs?.() || []).length === 0) return false;
    const baseType = base.getType?.() as any;
    const baseClassName = baseType?.getClassSignature?.()?.getClassName?.() || "";
    return baseClassName === "Promise" || base.getName?.() === "Promise";
}

function resolveOrCreateExactCalleeEndpointNodes(
    pag: Pag,
    value: any,
    anchorStmt: any,
    sourceNodes: Map<number, number>,
): Map<number, number> | undefined {
    if (!isBuildablePagValue(value)) return undefined;
    const out = new Map<number, number>();
    for (const sourceNodeId of sourceNodes.values()) {
        const sourceNode = pag.getNode(Number(sourceNodeId)) as any;
        let cid = 0;
        try {
            cid = Number(sourceNode?.getCid?.() ?? 0);
        } catch {
            cid = 0;
        }
        const nodes = materializeExactPagNodes(pag, value, anchorStmt, cid);
        const nodeId = nodes?.values?.().next?.().value;
        if (typeof nodeId === "number") {
            out.set(cid, nodeId);
        }
    }

    return out.size > 0 ? out : undefined;
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

