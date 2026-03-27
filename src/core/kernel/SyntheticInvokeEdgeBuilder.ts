import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { CallGraph } from "../../../arkanalyzer/out/src/callgraph/model/CallGraph";
import { Pag, PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt, ArkReturnStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import {
    ArkParameterRef,
    ArkInstanceFieldRef,
    ArkStaticFieldRef,
    ArkArrayRef,
    ArkThisRef,
    ClosureFieldRef,
} from "../../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import { Constant } from "../../../arkanalyzer/out/src/core/base/Constant";
import {
    AbstractExpr,
    ArkAwaitExpr,
    ArkInstanceInvokeExpr,
    ArkNewArrayExpr,
    ArkNewExpr,
} from "../../../arkanalyzer/out/src/core/base/Expr";
import { CallEdgeType } from "./context/TaintContext";
import { resolveCallbackMethodsFromValueWithReturns } from "../substrate/queries/CallbackBindingQuery";
import {
    analyzeInvokedParams,
    collectParameterAssignStmts,
    isCallableValue,
    isReflectDispatchInvoke,
    mapInvokeArgsToParamAssigns,
    resolveCalleeCandidates,
    resolveInvokeMethodName,
    resolveMethodsFromCallable
} from "../substrate/queries/CalleeResolver";
import { isSdkBackedMethodSignature } from "../substrate/queries/SdkProvenance";

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

interface SyntheticInvokeLookupStats {
    incomingLookupCalls: number;
    incomingDirectScanMs: number;
    incomingIndexBuildMs: number;
    incomingIndexBuilt: boolean;
    methodLookupCalls: number;
    methodLookupCacheHits: number;
}

interface SyntheticInvokeLookupContext {
    incomingCallsiteIndexByCalleeSig?: Map<string, any[]>;
    methodLookupCacheByFileAndProperty: Map<string, any[]>;
    methodsByFileCache: Map<string, any[]>;
    stats: SyntheticInvokeLookupStats;
}

interface AsyncCallbackBinding {
    method: any;
    sourceMethod: any;
    reason: "direct" | "one_hop" | "name_fallback";
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
    log: (msg: string) => void
): Map<number, SyntheticInvokeEdgeInfo[]> {
    const buildStartMs = Date.now();
    const edgeMap = new Map<number, SyntheticInvokeEdgeInfo[]>();
    let syntheticCallCount = 0;
    let syntheticReturnCount = 0;
    let fallbackCalleeCount = 0;
    const lazy = buildSyntheticInvokeLazyMaterializer(scene, cg, pag, log);

    for (const site of lazy.sites) {
        const stats = materializeSyntheticInvokeSite(scene, cg, pag, edgeMap, lazy, site);
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
            const asyncBindings = collectAsyncCallbackBindingsForStmt(scene, cg, caller, stmt, invokeExpr, lookupContext);
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
                asyncBindings,
                resolvedBindings
            );
            for (const nodeId of triggerNodeIds) {
                if (!siteIdsByTriggerNodeId.has(nodeId)) {
                    siteIdsByTriggerNodeId.set(nodeId, []);
                }
                siteIdsByTriggerNodeId.get(nodeId)!.push(site.id);
            }
            if (triggerNodeIds.size === 0 || asyncBindings.length > 0 || resolvedBindings.length > 0) {
                eagerSiteIds.add(site.id);
            }
        }
    }

    return {
        siteIdsByTriggerNodeId,
        sites,
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
    nodeId: number
): { callCount: number; returnCount: number; fallbackCalleeCount: number } {
    const siteIds = lazy.siteIdsByTriggerNodeId.get(nodeId) || [];
    let callCount = 0;
    let returnCount = 0;
    let fallbackCalleeCount = 0;

    for (const siteId of siteIds) {
        if (lazy.materializedSiteIds.has(siteId)) continue;
        lazy.materializedSiteIds.add(siteId);
        const site = lazy.sites.find(item => item.id === siteId);
        if (!site) continue;
        const stats = materializeSyntheticInvokeSite(scene, cg, pag, edgeMap, lazy, site);
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
    lazy: SyntheticInvokeLazyMaterializer
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
        const site = lazy.sites.find(item => item.id === siteId);
        if (!site) continue;
        const stats = materializeSyntheticInvokeSite(scene, cg, pag, edgeMap, lazy, site);
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
    lazy: SyntheticInvokeLazyMaterializer
): void {
    lazy.eagerSitesMaterialized = true;
    for (const site of lazy.sites) {
        if (lazy.materializedSiteIds.has(site.id)) continue;
        lazy.materializedSiteIds.add(site.id);
        materializeSyntheticInvokeSite(scene, cg, pag, edgeMap, lazy, site);
    }
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
    const capturedSummaryCache = new Map<string, Map<string, Set<string>>>();
    const capturedVisiting = new Set<string>();
    let count = 0;

    for (const caller of scene.getMethods()) {
        const cfg = caller.getCfg();
        if (!cfg) continue;

        for (const stmt of cfg.getStmts()) {
            if (!stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;

            const invokeSig = invokeExpr.getMethodSignature?.()?.toString?.() || "";
            const calleeSig = invokeExpr.getMethodSignature().toString();
            if (!calleeSig || calleeSig.includes("%unk") || !calleeSig.includes(".constructor(")) continue;

            const callee = scene.getMethods().find(m => m.getSignature().toString() === calleeSig);
            if (!callee || !callee.getCfg()) continue;

            const summary = summarizeConstructorParamToFields(scene, callee, summaryCache, visiting);
            const capturedSummary = summarizeConstructorCapturedLocalToFields(
                scene,
                callee,
                capturedSummaryCache,
                capturedVisiting
            );
            if (summary.size === 0 && capturedSummary.size === 0) continue;

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
                        for (const objId of collectCarrierObjectIds(baseNode)) {
                            for (const fieldName of fieldNames) {
                                pushCtorStore(map, srcNodeId, { srcNodeId, objId, fieldName });
                                count++;
                            }
                        }
                    }
                }
            }

            if (capturedSummary.size > 0) {
                const callerLocals = caller.getBody?.()?.getLocals?.();
                if (callerLocals) {
                    for (const [capturedLocalName, fieldNames] of capturedSummary.entries()) {
                        const callerLocal = callerLocals.get(capturedLocalName);
                        if (!(callerLocal instanceof Local)) continue;
                        const srcNodes = pag.getNodesByValue(callerLocal);
                        if (!srcNodes || srcNodes.size === 0) continue;

                        for (const srcNodeId of srcNodes.values()) {
                            for (const baseNodeId of baseNodes.values()) {
                                const baseNode = pag.getNode(baseNodeId) as PagNode;
                                for (const objId of collectCarrierObjectIds(baseNode)) {
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
        }
    }

    log(`Synthetic Constructor Store Map Built: ${count} field-store transfers.`);
    return map;
}

export function summarizeConstructorCapturedLocalToFields(
    scene: Scene,
    method: any,
    cache: Map<string, Map<string, Set<string>>>,
    visiting: Set<string>
): Map<string, Set<string>> {
    const sig = method.getSignature().toString();
    if (cache.has(sig)) return cache.get(sig)!;
    if (visiting.has(sig)) return new Map();
    visiting.add(sig);

    const result = new Map<string, Set<string>>();
    const cfg = method.getCfg();
    if (!cfg) {
        visiting.delete(sig);
        cache.set(sig, result);
        return result;
    }

    const paramLocalNames = new Set<string>();
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (left instanceof Local && right instanceof ArkParameterRef) {
            paramLocalNames.add(left.getName());
        }
    }

    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof ArkInstanceFieldRef)) continue;
        const leftBase = left.getBase();
        if (!(leftBase instanceof Local) || leftBase.getName() !== "this") continue;
        if (!(right instanceof Local)) continue;

        const localName = right.getName();
        // Captured locals from outer scope are stable identifiers (e.g. ctx/out).
        // Skip parameter aliases and compiler temporaries (%0/%1...) to avoid over-linking.
        if (paramLocalNames.has(localName)) continue;
        if (localName.startsWith("%")) continue;

        const fieldName = left.getFieldSignature().getFieldName();
        if (!result.has(localName)) result.set(localName, new Set<string>());
        result.get(localName)!.add(fieldName);
    }

    // Nested constructor relays can reuse the same captured local names across wrappers.
    for (const stmt of cfg.getStmts()) {
        if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
        const invokeExpr = stmt.getInvokeExpr();
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
        const calleeSig = invokeExpr.getMethodSignature().toString();
        if (!calleeSig || calleeSig.includes("%unk")) continue;
        if (!calleeSig.includes(".constructor(") && !calleeSig.includes("%instInit")) continue;
        const callee = scene.getMethods().find(m => m.getSignature().toString() === calleeSig);
        if (!callee || !callee.getCfg()) continue;
        const nested = summarizeConstructorCapturedLocalToFields(scene, callee, cache, visiting);
        for (const [localName, fields] of nested.entries()) {
            if (!result.has(localName)) result.set(localName, new Set<string>());
            for (const f of fields) result.get(localName)!.add(f);
        }
    }

    visiting.delete(sig);
    cache.set(sig, result);
    return result;
}

export function buildSyntheticFieldBridgeMap(
    scene: Scene,
    _cg: CallGraph,
    pag: Pag,
    log: (msg: string) => void
): Map<string, SyntheticFieldBridgeInfo[]> {
    const map = new Map<string, SyntheticFieldBridgeInfo[]>();
    const dedup = new Set<string>();
    const summaryCache = new Map<string, Map<string, Set<string>>>();
    const visiting = new Set<string>();
    let bridgeCount = 0;

    const pushBridge = (info: SyntheticFieldBridgeInfo): void => {
        const dedupKey = `${info.sourceObjectNodeId}#${info.sourceFieldName}->${info.targetObjectNodeId}#${info.targetFieldName}`;
        if (dedup.has(dedupKey)) return;
        dedup.add(dedupKey);
        const key = `${info.sourceObjectNodeId}#${info.sourceFieldName}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(info);
        bridgeCount++;
    };

    for (const caller of scene.getMethods()) {
        const cfg = caller.getCfg();
        const body = caller.getBody();
        if (!cfg || !body) continue;

        const callerThisLocal = [...body.getLocals().values()].find(l => l.getName() === "this");
        if (!callerThisLocal) continue;

        const callerThisNodes = pag.getNodesByValue(callerThisLocal);
        if (!callerThisNodes || callerThisNodes.size === 0) continue;
        const callerObjectIds = new Set<number>();
        for (const thisNodeId of callerThisNodes.values()) {
            const thisNode = pag.getNode(thisNodeId) as PagNode;
            for (const objId of thisNode.getPointTo()) {
                callerObjectIds.add(objId);
            }
        }
        if (callerObjectIds.size === 0) continue;

        for (const stmt of cfg.getStmts()) {
            if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;

            const calleeSig = invokeExpr.getMethodSignature().toString();
            if (!calleeSig || !calleeSig.includes(".constructor(")) continue;
            if (!calleeSig.includes("%AC")) continue; // only closure-like synthetic classes

            const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            if (args.length > 0) continue;

            const callee = scene.getMethods().find(m => m.getSignature().toString() === calleeSig);
            if (!callee || !callee.getCfg()) continue;

            const fieldCopySummary = summarizeThisFieldCopyMap(scene, callee, summaryCache, visiting);
            if (fieldCopySummary.size === 0) continue;

            const base = invokeExpr.getBase();
            const baseNodes = pag.getNodesByValue(base);
            if (!baseNodes || baseNodes.size === 0) continue;
            const targetObjectIds = new Set<number>();
            for (const baseNodeId of baseNodes.values()) {
                const baseNode = pag.getNode(baseNodeId) as PagNode;
                for (const objId of baseNode.getPointTo()) {
                    targetObjectIds.add(objId);
                }
            }
            if (targetObjectIds.size === 0) continue;

            for (const sourceObjectNodeId of callerObjectIds) {
                for (const [sourceFieldName, targetFieldNames] of fieldCopySummary.entries()) {
                    for (const targetObjectNodeId of targetObjectIds) {
                        for (const targetFieldName of targetFieldNames) {
                            pushBridge({
                                sourceObjectNodeId,
                                sourceFieldName,
                                targetObjectNodeId,
                                targetFieldName,
                                methodSignature: caller.getSignature().toString(),
                            });
                        }
                    }
                }
            }
        }
    }

    log(`Synthetic Field Bridge Map Built: ${bridgeCount} bridge transfers.`);
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

function summarizeThisFieldCopyMap(
    scene: Scene,
    method: any,
    cache: Map<string, Map<string, Set<string>>>,
    visiting: Set<string>
): Map<string, Set<string>> {
    const sig = method.getSignature().toString();
    if (cache.has(sig)) return cache.get(sig)!;
    if (visiting.has(sig)) return new Map();
    visiting.add(sig);

    const result = new Map<string, Set<string>>();
    const cfg = method.getCfg();
    if (!cfg) {
        visiting.delete(sig);
        cache.set(sig, result);
        return result;
    }
    const localToSourceFields = new Map<string, Set<string>>();

    const mergeEdge = (sourceField: string, targetField: string): void => {
        if (!result.has(sourceField)) result.set(sourceField, new Set<string>());
        result.get(sourceField)!.add(targetField);
    };
    const mergeLocalSourceField = (localName: string, sourceField: string): void => {
        if (!localToSourceFields.has(localName)) localToSourceFields.set(localName, new Set<string>());
        localToSourceFields.get(localName)!.add(sourceField);
    };

    for (const stmt of cfg.getStmts()) {
        if (stmt instanceof ArkAssignStmt) {
            const left = stmt.getLeftOp();
            const right = stmt.getRightOp();
            if (left instanceof ArkInstanceFieldRef && right instanceof ArkInstanceFieldRef) {
                const leftBase = left.getBase();
                const rightBase = right.getBase();
                if (
                    leftBase instanceof Local
                    && rightBase instanceof Local
                    && leftBase.getName() === "this"
                    && rightBase.getName() === "this"
                ) {
                    const sourceField = right.getFieldSignature().getFieldName();
                    const targetField = left.getFieldSignature().getFieldName();
                    mergeEdge(sourceField, targetField);
                }
            }

            if (left instanceof Local && right instanceof ArkInstanceFieldRef) {
                const rightBase = right.getBase();
                if (rightBase instanceof Local && rightBase.getName() === "this") {
                    mergeLocalSourceField(left.getName(), right.getFieldSignature().getFieldName());
                }
            }

            if (left instanceof Local && right instanceof Local) {
                const inherited = localToSourceFields.get(right.getName());
                if (inherited) {
                    for (const sourceField of inherited) {
                        mergeLocalSourceField(left.getName(), sourceField);
                    }
                }
            }

            if (left instanceof ArkInstanceFieldRef && right instanceof Local) {
                const leftBase = left.getBase();
                if (leftBase instanceof Local && leftBase.getName() === "this") {
                    const inherited = localToSourceFields.get(right.getName());
                    if (inherited) {
                        const targetField = left.getFieldSignature().getFieldName();
                        for (const sourceField of inherited) {
                            mergeEdge(sourceField, targetField);
                        }
                    }
                }
            }
        }

        if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
        const invokeExpr = stmt.getInvokeExpr();
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
        const calleeSig = invokeExpr.getMethodSignature().toString();
        if (!calleeSig || calleeSig.includes("%unk")) continue;
        if (!calleeSig.includes(".%instInit()")) continue;

        const callee = scene.getMethods().find(m => m.getSignature().toString() === calleeSig);
        if (!callee || !callee.getCfg()) continue;
        const nested = summarizeThisFieldCopyMap(scene, callee, cache, visiting);
        for (const [sourceField, targetFieldNames] of nested.entries()) {
            for (const targetField of targetFieldNames) {
                mergeEdge(sourceField, targetField);
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

function collectCarrierObjectIds(baseNode: PagNode): number[] {
    const ids = [...baseNode.getPointTo()];
    if (ids.length > 0) return ids;
    return [baseNode.getID()];
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
    asyncBindings?: AsyncCallbackBinding[],
    resolvedBindings?: AsyncCallbackBinding[]
): Set<number> {
    const triggerNodeIds = new Set<number>();
    const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    for (const arg of args) {
        for (const nodeId of getOrCreatePagNodes(pag, arg, stmt)?.values?.() || []) {
            triggerNodeIds.add(nodeId);
        }
    }
    const base = invokeExpr.getBase?.();
    if (base) {
        for (const nodeId of getOrCreatePagNodes(pag, base, stmt)?.values?.() || []) {
            triggerNodeIds.add(nodeId);
        }
    }

    const asyncResolvedBindings = asyncBindings || collectAsyncCallbackBindingsForStmt(scene, cg, caller, stmt, invokeExpr, lookupContext);
    for (const binding of asyncResolvedBindings) {
        for (const nodeId of collectCallbackBindingTriggerNodeIds(pag, stmt, binding.method, binding.sourceMethod || caller)) {
            triggerNodeIds.add(nodeId);
        }
    }

    const resolvedTargets = collectResolvedInvokeTargets(scene, cg, stmt, invokeExpr);
    for (const callee of resolvedTargets) {
        const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        const paramStmts = collectParameterAssignStmts(callee);
        for (const pair of mapInvokeArgsToParamAssigns(invokeExpr, explicitArgs, paramStmts)) {
            for (const nodeId of getOrCreatePagNodes(pag, pair.arg, stmt)?.values?.() || []) {
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
    site: SyntheticInvokeLazySite
): { callCount: number; returnCount: number; fallbackCalleeCount: number } {
    const { caller, stmt, invokeExpr } = site;
    const callCount = injectAsyncCallbackCaptureEdges(
        scene,
        cg,
        pag,
        caller,
        stmt,
        invokeExpr,
        edgeMap,
        lazy.lookupContext
    ) + injectResolvedCallbackParameterEdges(
        scene,
        cg,
        pag,
        caller,
        stmt,
        invokeExpr,
        edgeMap,
        lazy.invokedParamCache
    );

    const directStats = materializeDirectSyntheticInvokeEdges(
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
                pag.addPagNode(0, paramStmt.getLeftOp(), paramStmt);
                dstNodes = pag.getNodesByValue(paramStmt.getLeftOp());
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

function collectAsyncCallbackBindingsForStmt(
    scene: Scene,
    cg: CallGraph,
    caller: any,
    stmt: any,
    invokeExpr: any,
    lookupContext: SyntheticInvokeLookupContext
): AsyncCallbackBinding[] {
    const invokeName = resolveInvokeMethodName(invokeExpr);
    const asyncNames = new Set(["setTimeout", "setInterval", "queueMicrotask", "requestAnimationFrame"]);
    if (!asyncNames.has(invokeName)) return [];
    const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    if (args.length === 0) return [];
    const callbackArg = args[0];
    const callsiteLine = stmt.getOriginPositionInfo?.()?.getLineNo?.() || 0;
    return resolveAsyncCallbackBindings(scene, cg, caller, callbackArg, callsiteLine, lookupContext);
}

function collectResolvedCallbackBindingsForStmt(
    scene: Scene,
    cg: CallGraph,
    caller: any,
    stmt: any,
    invokeExpr: any,
    invokedParamCache: Map<string, Set<number>>
): AsyncCallbackBinding[] {
    const out: AsyncCallbackBinding[] = [];
    const seen = new Set<string>();
    const resolvedCallees = collectResolvedInvokeTargets(scene, cg, stmt, invokeExpr);
    for (const callee of resolvedCallees) {
        const isSdk = isSdkBackedMethodSignature(scene, callee.getSignature?.(), {
            sourceMethod: caller,
            invokeExpr,
        });
        const paramStmts = collectParameterAssignStmts(callee);
        const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];

        if (paramStmts.length > 0) {
            const pairs = mapInvokeArgsToParamAssigns(invokeExpr, explicitArgs, paramStmts);
            const invokedParams = isSdk ? undefined : getCachedInvokedParams(callee, invokedParamCache);

            for (const pair of pairs) {
                const callbackMethods = resolveSyntheticCallbackMethodsForArg(scene, pair.arg, isSdk)
                    .filter(method => !!method?.getCfg?.());
                if (callbackMethods.length === 0) continue;
                if (!isSdk && (!invokedParams || !invokedParams.has(pair.paramIndex))) continue;

                for (const callbackMethod of callbackMethods) {
                    const callbackSig = callbackMethod.getSignature?.().toString?.() || "";
                    if (!callbackSig || seen.has(callbackSig)) continue;
                    seen.add(callbackSig);
                    out.push({
                        method: callbackMethod,
                        sourceMethod: caller,
                        reason: "direct",
                    });
                }
            }
        } else if (isSdk) {
            for (const arg of explicitArgs) {
                const callbackMethods = resolveSyntheticCallbackMethodsForArg(scene, arg, true)
                    .filter(method => !!method?.getCfg?.());
                for (const callbackMethod of callbackMethods) {
                    const callbackSig = callbackMethod.getSignature?.().toString?.() || "";
                    if (!callbackSig || seen.has(callbackSig)) continue;
                    seen.add(callbackSig);
                    out.push({
                        method: callbackMethod,
                        sourceMethod: caller,
                        reason: "direct",
                    });
                }
            }
        }
    }
    return out;
}

function collectCallbackBindingTriggerNodeIds(
    pag: Pag,
    stmt: any,
    cbMethod: any,
    sourceMethod: any
): Set<number> {
        const sourceBody = sourceMethod?.getBody?.();
        const sourceLocals = sourceBody?.getLocals?.();
    const out = new Set<number>();
    if (!sourceLocals) return out;

        const paramStmts = collectParameterAssignStmts(cbMethod);
    for (const paramStmt of paramStmts) {
        const paramLocal = paramStmt.getLeftOp();
        if (!(paramLocal instanceof Local)) continue;
        const callerLocal = sourceLocals.get(paramLocal.getName());
        if (!(callerLocal instanceof Local)) continue;
        for (const nodeId of getOrCreatePagNodes(pag, callerLocal, stmt)?.values?.() || []) {
            out.add(nodeId);
        }
    }

    const capturedLocalMappings = collectCallbackCapturedLocalMappings(cbMethod, paramStmts);
    for (const mapping of capturedLocalMappings) {
        const callerLocal = sourceLocals.get(mapping.callerLocalName);
        if (!(callerLocal instanceof Local)) continue;
        for (const nodeId of getOrCreatePagNodes(pag, callerLocal, stmt)?.values?.() || []) {
            out.add(nodeId);
        }
    }

    return out;
}

function injectResolvedCallbackParameterEdges(
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    caller: any,
    stmt: any,
    invokeExpr: any,
    edgeMap: Map<number, SyntheticInvokeEdgeInfo[]>,
    invokedParamCache: Map<string, Set<number>>
): number {
    const resolvedCallees = collectResolvedInvokeTargets(scene, cg, stmt, invokeExpr);
    if (resolvedCallees.length === 0) return 0;

    let count = 0;
    const seenBindings = new Set<string>();
    for (const callee of resolvedCallees) {
        const isSdk = isSdkBackedMethodSignature(scene, callee.getSignature?.(), {
            sourceMethod: caller,
            invokeExpr,
        });
        const paramStmts = collectParameterAssignStmts(callee);
        const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];

        if (paramStmts.length > 0) {
            const pairs = mapInvokeArgsToParamAssigns(invokeExpr, explicitArgs, paramStmts);
            const invokedParams = isSdk ? undefined : getCachedInvokedParams(callee, invokedParamCache);

            for (const pair of pairs) {
                const callbackMethods = resolveSyntheticCallbackMethodsForArg(scene, pair.arg, isSdk)
                    .filter(method => !!method?.getCfg?.());
                if (callbackMethods.length === 0) continue;
                if (!isSdk && (!invokedParams || !invokedParams.has(pair.paramIndex))) continue;

                for (const callbackMethod of callbackMethods) {
                    const callbackSig = callbackMethod.getSignature?.().toString?.() || "";
                    if (!callbackSig) continue;
                    const bindingKey = `${stmt.getOriginPositionInfo?.()?.getLineNo?.() || 0}`
                        + `#${callee.getSignature?.().toString?.() || ""}`
                        + `#${pair.paramIndex}`
                        + `#${callbackSig}`;
                    if (seenBindings.has(bindingKey)) continue;
                    seenBindings.add(bindingKey);
                    count += injectCallbackBindingEdges(pag, caller, stmt, edgeMap, callbackMethod, caller);
                }
            }
        } else if (isSdk) {
            for (let argIdx = 0; argIdx < explicitArgs.length; argIdx++) {
                const callbackMethods = resolveSyntheticCallbackMethodsForArg(scene, explicitArgs[argIdx], true)
                    .filter(method => !!method?.getCfg?.());
                for (const callbackMethod of callbackMethods) {
                    const callbackSig = callbackMethod.getSignature?.().toString?.() || "";
                    if (!callbackSig) continue;
                    const bindingKey = `${stmt.getOriginPositionInfo?.()?.getLineNo?.() || 0}`
                        + `#${callee.getSignature?.().toString?.() || ""}`
                        + `#${argIdx}`
                        + `#${callbackSig}`;
                    if (seenBindings.has(bindingKey)) continue;
                    seenBindings.add(bindingKey);
                    count += injectCallbackBindingEdges(pag, caller, stmt, edgeMap, callbackMethod, caller);
                }
            }
        }
    }

    return count;
}

function collectResolvedInvokeTargets(
    scene: Scene,
    cg: CallGraph,
    stmt: any,
    invokeExpr: any
): any[] {
    const out: any[] = [];
    const seen = new Set<string>();
    const add = (method: any): void => {
        if (!method || !method.getCfg?.()) return;
        const sig = method.getSignature?.().toString?.();
        if (!sig || seen.has(sig)) return;
        seen.add(sig);
        out.push(method);
    };

    const callSites = cg.getCallSiteByStmt(stmt) || [];
    for (const cs of callSites) {
        const calleeFuncID = cs.getCalleeFuncID?.();
        if (!calleeFuncID) continue;
        add(cg.getArkMethodByFuncID(calleeFuncID));
    }

    if (out.length > 0 && !isReflectDispatchInvoke(invokeExpr) && !isUnknownInvokeSignature(invokeExpr)) {
        return out;
    }

    for (const resolved of resolveCalleeCandidates(scene, invokeExpr)) {
        add(resolved.method);
    }
    return out;
}

function getCachedInvokedParams(
    method: any,
    cache: Map<string, Set<number>>
): Set<number> {
    const sig = method?.getSignature?.().toString?.() || "";
    if (!sig) return new Set<number>();
    if (!cache.has(sig)) {
        cache.set(sig, analyzeInvokedParams(method));
    }
    return cache.get(sig)!;
}

function resolveSyntheticCallbackMethodsForArg(
    scene: Scene,
    arg: any,
    isSdk: boolean
): any[] {
    const out: any[] = [];
    const seen = new Set<string>();
    const addMethod = (method: any): void => {
        if (!method?.getCfg?.()) return;
        const sig = method.getSignature?.().toString?.();
        if (!sig || seen.has(sig)) return;
        seen.add(sig);
        out.push(method);
    };

    if (isCallableValue(arg)) {
        for (const method of resolveMethodsFromCallable(scene, arg, { maxCandidates: 8 })) {
            addMethod(method);
        }
    }

    // SDK methods have no body, so options-pattern callbacks hidden in %AC object carriers
    // need to be conservatively expanded here as synthetic callback callees.
    if (isSdk) {
        for (const method of resolveMethodsFromAnonymousObjectCarrier(scene, arg)) {
            addMethod(method);
        }
    }

    return out;
}

function injectCallbackBindingEdges(
    pag: Pag,
    caller: any,
    stmt: any,
    edgeMap: Map<number, SyntheticInvokeEdgeInfo[]>,
    cbMethod: any,
    sourceMethod: any
): number {
    const sourceBody = sourceMethod?.getBody?.();
    const sourceLocals = sourceBody?.getLocals?.();
    if (!sourceLocals) return 0;

    const paramStmts = collectParameterAssignStmts(cbMethod);
        const calleeSig = cbMethod.getSignature().toString();
        const callSiteId = stmt.getOriginPositionInfo().getLineNo() * 10000 + simpleHash(calleeSig);
        const capturedLocalMappings = collectCallbackCapturedLocalMappings(cbMethod, paramStmts);

    let count = 0;
        if (paramStmts.length > 0) {
            for (const paramStmt of paramStmts) {
                const paramLocal = paramStmt.getLeftOp();
                if (!(paramLocal instanceof Local)) continue;
            const callerLocal = sourceLocals.get(paramLocal.getName());
                if (!(callerLocal instanceof Local)) continue;

                const srcNodes = getOrCreatePagNodes(pag, callerLocal, stmt);
                let dstNodes = getOrCreatePagNodes(pag, paramLocal, paramStmt);
                if ((!dstNodes || dstNodes.size === 0) && paramStmt.getRightOp() instanceof ArkParameterRef) {
                    dstNodes = getOrCreatePagNodes(pag, paramStmt.getRightOp(), paramStmt);
                }
                if (!srcNodes || !dstNodes) continue;

                for (const srcNodeId of srcNodes.values()) {
                    for (const dstNodeId of dstNodes.values()) {
                        pushEdge(edgeMap, srcNodeId, {
                            type: CallEdgeType.CALL,
                            srcNodeId,
                            dstNodeId,
                            callSiteId,
                            callerMethodName: sourceMethod.getName?.() || caller.getName(),
                            calleeMethodName: cbMethod.getName(),
                            callerSignature: sourceMethod.getSignature?.().toString?.() || caller.getSignature?.().toString?.(),
                            calleeSignature: calleeSig,
                        });
                        count++;
                    }
                }
            }
        }

        for (const mapping of capturedLocalMappings) {
            const callerLocal = sourceLocals.get(mapping.callerLocalName);
            if (!(callerLocal instanceof Local)) continue;

            const srcNodes = getOrCreatePagNodes(pag, callerLocal, stmt);
            const dstNodes = mapping.anchorStmt
                ? getOrCreatePagNodes(pag, mapping.callbackValue, mapping.anchorStmt)
                : pag.getNodesByValue(mapping.callbackValue);
            if (!srcNodes || !dstNodes) continue;

            for (const srcNodeId of srcNodes.values()) {
                for (const dstNodeId of dstNodes.values()) {
                    pushEdge(edgeMap, srcNodeId, {
                        type: CallEdgeType.CALL,
                        srcNodeId,
                        dstNodeId,
                        callSiteId,
                        callerMethodName: sourceMethod.getName?.() || caller.getName(),
                        calleeMethodName: cbMethod.getName(),
                        callerSignature: sourceMethod.getSignature?.().toString?.() || caller.getSignature?.().toString?.(),
                        calleeSignature: calleeSig,
                    });
                    count++;
                }
            }
        }

    if (count === 0) {
        const srcNodeId = findAnyPagNodeForStmt(pag, stmt);
        const dstNodeId = findAnyPagNodeForMethod(pag, cbMethod);
        if (srcNodeId !== undefined && dstNodeId !== undefined) {
            pushEdge(edgeMap, srcNodeId, {
                type: CallEdgeType.CALL,
                srcNodeId,
                dstNodeId,
                callSiteId,
                callerMethodName: sourceMethod.getName?.() || caller.getName(),
                calleeMethodName: cbMethod.getName(),
                callerSignature: sourceMethod.getSignature?.().toString?.() || caller.getSignature?.().toString?.(),
                calleeSignature: calleeSig,
            });
            count = 1;
        }
    }

    return count;
}

function injectAsyncCallbackCaptureEdges(
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    caller: any,
    stmt: any,
    invokeExpr: any,
    edgeMap: Map<number, SyntheticInvokeEdgeInfo[]>,
    context?: SyntheticInvokeLookupContext
): number {
    const invokeName = resolveInvokeMethodName(invokeExpr);
    const asyncNames = new Set(["setTimeout", "setInterval", "queueMicrotask", "requestAnimationFrame"]);
    if (!asyncNames.has(invokeName)) return 0;

    const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    if (args.length === 0) return 0;
    const callbackArg = args[0];
    const callsiteLine = stmt.getOriginPositionInfo?.()?.getLineNo?.() || 0;
    const callbackBindings = resolveAsyncCallbackBindings(scene, cg, caller, callbackArg, callsiteLine, context);
    if (callbackBindings.length === 0) return 0;

    let count = 0;
    for (const binding of callbackBindings) {
        count += injectCallbackBindingEdges(pag, caller, stmt, edgeMap, binding.method, binding.sourceMethod || caller);
    }

    return count;
}

function findAnyPagNodeForStmt(pag: Pag, stmt: any): number | undefined {
    for (const value of [stmt.getLeftOp?.(), stmt.getRightOp?.(), stmt.getInvokeExpr?.()?.getBase?.()]) {
        if (!value) continue;
        const nodes = pag.getNodesByValue(value);
        if (nodes && nodes.size > 0) return nodes.values().next().value;
    }
    const args = stmt.getInvokeExpr?.()?.getArgs?.() || [];
    for (const arg of args) {
        const nodes = pag.getNodesByValue(arg);
        if (nodes && nodes.size > 0) return nodes.values().next().value;
    }
    return undefined;
}

function findAnyPagNodeForMethod(pag: Pag, method: any): number | undefined {
    const cfg = method.getCfg?.();
    if (!cfg) return undefined;
    for (const s of cfg.getStmts()) {
        const left = s.getLeftOp?.();
        if (left) {
            const nodes = pag.getNodesByValue(left);
            if (nodes && nodes.size > 0) return nodes.values().next().value;
        }
        const right = s.getRightOp?.();
        if (right) {
            const nodes = pag.getNodesByValue(right);
            if (nodes && nodes.size > 0) return nodes.values().next().value;
        }
    }
    return undefined;
}

function getOrCreatePagNodes(pag: Pag, value: any, anchorStmt: any): Map<number, number> | undefined {
    const pagValue = resolvePagNodeValue(value, anchorStmt);
    if (!pagValue) {
        return undefined;
    }

    let nodes = pag.getNodesByValue(pagValue);
    if (nodes && nodes.size > 0) {
        return nodes;
    }
    if (!anchorStmt) {
        return nodes;
    }
    try {
        pag.addPagNode(0, pagValue, anchorStmt);
    } catch {
        return undefined;
    }
    nodes = pag.getNodesByValue(pagValue);
    return nodes;
}

function resolvePagNodeValue(value: any, anchorStmt: any, visiting: Set<any> = new Set()): any | undefined {
    if (!value || visiting.has(value)) {
        return undefined;
    }
    visiting.add(value);

    if (isPagNodeValue(value)) {
        return value;
    }

    if (value instanceof ArkAwaitExpr) {
        return resolvePagNodeValue(value.getPromise(), anchorStmt, visiting);
    }

    if (value instanceof AbstractExpr) {
        const uses = value.getUses?.() || [];
        for (const use of uses) {
            const resolved = resolvePagNodeValue(use, anchorStmt, visiting);
            if (resolved) {
                return resolved;
            }
        }
    }

    const left = anchorStmt?.getLeftOp?.();
    if (left && left !== value) {
        const resolvedLeft = resolvePagNodeValue(left, undefined, visiting);
        if (resolvedLeft) {
            return resolvedLeft;
        }
    }

    return undefined;
}

function isPagNodeValue(value: any): boolean {
    return value instanceof Local
        || value instanceof ArkInstanceFieldRef
        || value instanceof ArkStaticFieldRef
        || value instanceof ArkArrayRef
        || value instanceof ArkNewExpr
        || value instanceof ArkNewArrayExpr
        || value instanceof ArkParameterRef
        || value instanceof ArkThisRef
        || value instanceof Constant;
}

function resolveAsyncCallbackBindings(
    scene: Scene,
    cg: CallGraph,
    callerMethod: any,
    callbackArg: any,
    callsiteLine: number = 0,
    context?: SyntheticInvokeLookupContext
): AsyncCallbackBinding[] {
    const LINE_NEARBY_WARNING_THRESHOLD = 50;
    const methods = resolveMethodsFromCallable(scene, callbackArg, { maxCandidates: 8 })
        .filter(m => (m.getName?.() || "").startsWith("%AM"));
    if (methods.length > 0) {
        return methods.map(method => ({
            method,
            sourceMethod: callerMethod,
            reason: "direct" as const,
        }));
    }

    const callbackParamIndex = resolveCallbackParameterIndexInCurrentMethod(callerMethod, callbackArg);
    if (callbackParamIndex !== undefined && callbackParamIndex >= 0) {
        // 7.8.3 hard rule: callback-as-parameter uses one-hop summary only.
        // If one-hop evidence is empty, degrade safely by adding no edges.
        return resolveAsyncCallbackBindingsFromOneHopCallers(scene, cg, callerMethod, callbackParamIndex, context);
    }

    const callerSig = callerMethod?.getSignature?.().toString?.() || "";
    const callerFile = extractFilePathFromSignature(callerSig);
    if (!callerFile) return [];
    const callerName = callerMethod?.getName?.() || "";
    const callbackCandidateNames = new Set<string>();
    const callbackArgName = callbackArg?.getName?.();
    if (callbackArgName) callbackCandidateNames.add(String(callbackArgName));
    const callbackArgText = callbackArg?.toString?.();
    if (callbackArgText) callbackCandidateNames.add(String(callbackArgText));

    const candidates = scene.getMethods().filter(m => {
        const name = m.getName?.() || "";
        if (!name.startsWith("%AM")) return false;
        const sig = m.getSignature?.().toString?.() || "";
        if (!sig) return false;
        if (extractFilePathFromSignature(sig) !== callerFile) return false;
        return true;
    });

    const strictMatches = candidates.filter(m => {
        const name = m.getName?.() || "";
        if (callerName && name.includes(`$${callerName}`)) return true;
        if (callbackCandidateNames.has(name)) return true;
        return false;
    });
    if (strictMatches.length > 0) {
        return strictMatches.slice(0, 8).map(method => ({
            method,
            sourceMethod: callerMethod,
            reason: "name_fallback" as const,
        }));
    }

    if (callsiteLine > 0) {
        const sorted = [...candidates].sort((a, b) => {
            const da = Math.abs(extractLineNoFromSignature(a.getSignature?.().toString?.() || "") - callsiteLine);
            const db = Math.abs(extractLineNoFromSignature(b.getSignature?.().toString?.() || "") - callsiteLine);
            return da - db;
        });
        const nearest = sorted[0];
        if (nearest) {
            const nearestLine = extractLineNoFromSignature(nearest.getSignature?.().toString?.() || "");
            if (nearestLine !== Number.MAX_SAFE_INTEGER) {
                const nearestDelta = Math.abs(nearestLine - callsiteLine);
                if (nearestDelta > LINE_NEARBY_WARNING_THRESHOLD) {
                    const callerSigText = callerMethod?.getSignature?.().toString?.() || "<unknown-caller>";
                    // Keep behavior unchanged (still returns nearest candidates), but surface potential mismatch for debugging.
                    console.warn(`[arktaint][async-fallback] line-distance=${nearestDelta} (> ${LINE_NEARBY_WARNING_THRESHOLD}), caller=${callerSigText}, callbackArg=${String(callbackArg?.toString?.() || "")}`);
                }
            }
        }
        return sorted.slice(0, 8).map(method => ({
            method,
            sourceMethod: callerMethod,
            reason: "name_fallback" as const,
        }));
    }

    return candidates.slice(0, 8).map(method => ({
        method,
        sourceMethod: callerMethod,
        reason: "name_fallback" as const,
    }));
}

function resolveAsyncCallbackBindingsFromOneHopCallers(
    scene: Scene,
    cg: CallGraph,
    callerMethod: any,
    callbackParamIndex: number,
    context?: SyntheticInvokeLookupContext
): AsyncCallbackBinding[] {
    return resolveOneHopCallbackBindingsFromParamIndex(scene, cg, callerMethod, callbackParamIndex, 8, context);
}

function resolveOneHopCallbackBindingsFromParamIndex(
    scene: Scene,
    cg: CallGraph,
    calleeMethod: any,
    targetParamIndex: number,
    maxCandidates: number,
    context?: SyntheticInvokeLookupContext
): AsyncCallbackBinding[] {
    const incomingCallSites = collectIncomingCallSitesForCallee(scene, cg, calleeMethod, context);
    if (incomingCallSites.length === 0) return [];

    const calleeParamStmts = collectParameterAssignStmts(calleeMethod);
    const out: AsyncCallbackBinding[] = [];
    const seen = new Set<string>();
    const addMethod = (m: any, sourceMethod: any): void => {
        if (!m || !m.getCfg || !m.getCfg()) return;
        const sig = m.getSignature?.().toString?.();
        const sourceSig = sourceMethod?.getSignature?.()?.toString?.() || "";
        const key = `${sourceSig}=>${sig}`;
        if (!sig || seen.has(key)) return;
        seen.add(key);
        out.push({
            method: m,
            sourceMethod: sourceMethod || calleeMethod,
            reason: "one_hop",
        });
    };

    for (const cs of incomingCallSites) {
        const callStmt = cs.callStmt;
        const invokeExpr = callStmt?.getInvokeExpr?.();
        if (!invokeExpr) continue;
        const sourceMethod = callStmt?.getCfg?.()?.getDeclaringMethod?.() || calleeMethod;

        const explicitArgs = cs.args || (invokeExpr.getArgs ? invokeExpr.getArgs() : []);
        const argToParamPairs = mapInvokeArgsToParamAssigns(invokeExpr, explicitArgs, calleeParamStmts);
        for (const pair of argToParamPairs) {
            // Hard constraint for 7.8.3 one-hop summary: exact param-index alignment only.
            if (pair.paramIndex !== targetParamIndex) continue;

            const methods = resolveCallbackMethodsFromValueWithReturns(scene, pair.arg, { maxDepth: 6 });
            if (methods.length === 0 && !isCallableValue(pair.arg)) continue;
            for (const m of methods) addMethod(m, sourceMethod);
        }
    }

    // Safety degrade: evidence too broad -> do not add synthetic edges by guess.
    if (out.length > maxCandidates) return [];
    return out;
}

function collectIncomingCallSitesForCallee(
    scene: Scene,
    cg: CallGraph,
    calleeMethod: any,
    context?: SyntheticInvokeLookupContext
): any[] {
    const targetSig = calleeMethod?.getSignature?.()?.toString?.() || "";
    if (!targetSig) return [];

    if (context) {
        context.stats.incomingLookupCalls++;
        if (context.incomingCallsiteIndexByCalleeSig) {
            return context.incomingCallsiteIndexByCalleeSig.get(targetSig) || [];
        }
        if (context.stats.incomingLookupCalls >= 3) {
            const indexStart = Date.now();
            context.incomingCallsiteIndexByCalleeSig = buildIncomingCallsiteIndex(scene, cg);
            context.stats.incomingIndexBuildMs += (Date.now() - indexStart);
            context.stats.incomingIndexBuilt = true;
            return context.incomingCallsiteIndexByCalleeSig.get(targetSig) || [];
        }
    }

    const scanStart = Date.now();
    const out: any[] = [];
    const seen = new Set<string>();
    for (const method of scene.getMethods()) {
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
            const callSites = cg.getCallSiteByStmt(stmt) || [];
            for (const cs of callSites) {
                const calleeFuncID = cs.getCalleeFuncID?.();
                if (calleeFuncID === undefined || calleeFuncID === null) continue;
                const csCalleeSig = cg.getMethodByFuncID(calleeFuncID)?.toString?.() || "";
                if (csCalleeSig !== targetSig) continue;
                const key = `${cs.callerFuncID || -1}#${calleeFuncID}#${stmt.getOriginPositionInfo?.()?.getLineNo?.() || -1}#${stmt.toString?.() || ""}`;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push(cs);
            }
        }
    }
    if (context) {
        context.stats.incomingDirectScanMs += (Date.now() - scanStart);
    }
    return out;
}

function buildIncomingCallsiteIndex(scene: Scene, cg: CallGraph): Map<string, any[]> {
    const out = new Map<string, any[]>();
    const dedup = new Map<string, Set<string>>();
    for (const method of scene.getMethods()) {
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
            const callSites = cg.getCallSiteByStmt(stmt) || [];
            for (const cs of callSites) {
                const calleeFuncID = cs.getCalleeFuncID?.();
                if (calleeFuncID === undefined || calleeFuncID === null) continue;
                const calleeSig = cg.getMethodByFuncID(calleeFuncID)?.toString?.() || "";
                if (!calleeSig) continue;
                const key = `${cs.callerFuncID || -1}#${calleeFuncID}#${stmt.getOriginPositionInfo?.()?.getLineNo?.() || -1}#${stmt.toString?.() || ""}`;
                if (!dedup.has(calleeSig)) dedup.set(calleeSig, new Set<string>());
                const seen = dedup.get(calleeSig)!;
                if (seen.has(key)) continue;
                seen.add(key);
                if (!out.has(calleeSig)) out.set(calleeSig, []);
                out.get(calleeSig)!.push(cs);
            }
        }
    }
    return out;
}

function resolveReflectDispatchOneHopFallbackCallees(
    scene: Scene,
    cg: CallGraph,
    callerMethod: any,
    invokeExpr: any,
    context?: SyntheticInvokeLookupContext
): Array<{ method: any; reason: "type_fallback" }> {
    const args = invokeExpr?.getArgs ? invokeExpr.getArgs() : [];
    const base = invokeExpr?.getBase?.();
    const candidateValues: any[] = [];
    if (args.length > 0) candidateValues.push(args[0]);
    if (base !== undefined && base !== null) candidateValues.push(base);

    const out: Array<{ method: any; reason: "type_fallback" }> = [];
    const seen = new Set<string>();
    for (const candidate of candidateValues) {
        const paramIndex = resolveCallbackParameterIndexInCurrentMethod(callerMethod, candidate);
        if (paramIndex === undefined || paramIndex < 0) continue;

        const bindings = resolveOneHopCallbackBindingsFromParamIndex(scene, cg, callerMethod, paramIndex, 8, context);
        for (const binding of bindings) {
            const method = binding.method;
            const sig = method?.getSignature?.().toString?.();
            if (!sig || seen.has(sig)) continue;
            seen.add(sig);
            out.push({ method, reason: "type_fallback" });
        }
    }

    if (out.length > 8) return [];
    return out;
}

function resolveDynamicPropertyOneHopFallbackCallees(
    scene: Scene,
    cg: CallGraph,
    calleeMethod: any,
    invokeExpr: any,
    context?: SyntheticInvokeLookupContext
): Array<{ method: any; reason: "type_fallback" }> {
    const invokeSig = invokeExpr?.getMethodSignature?.()?.toString?.() || "";
    if (!invokeSig.includes("%unk")) return [];

    const base = invokeExpr?.getBase?.();
    if (!(base instanceof Local)) return [];

    const calleeParamStmts = collectParameterAssignStmts(calleeMethod);
    if (calleeParamStmts.length === 0) return [];

    const paramLocalNameToIndex = new Map<string, number>();
    for (let i = 0; i < calleeParamStmts.length; i++) {
        const left = calleeParamStmts[i]?.getLeftOp?.();
        if (!(left instanceof Local)) continue;
        paramLocalNameToIndex.set(left.getName(), i);
    }
    const baseParamIndex = paramLocalNameToIndex.get(base.getName());
    if (baseParamIndex === undefined) return [];

    const forwardedParamIndexes = new Set<number>();
    const invokeArgs = invokeExpr?.getArgs ? invokeExpr.getArgs() : [];
    for (const arg of invokeArgs) {
        if (!(arg instanceof Local)) continue;
        const idx = paramLocalNameToIndex.get(arg.getName());
        if (idx !== undefined) forwardedParamIndexes.add(idx);
    }

    const keyParamIndexes: number[] = [];
    for (let i = 0; i < calleeParamStmts.length; i++) {
        if (i === baseParamIndex) continue;
        if (forwardedParamIndexes.has(i)) continue;
        keyParamIndexes.push(i);
    }
    if (keyParamIndexes.length === 0) return [];

    const incomingCallSitesStable = collectIncomingCallSitesForCallee(scene, cg, calleeMethod, context);
    if (incomingCallSitesStable.length === 0) return [];

    const out: Array<{ method: any; reason: "type_fallback" }> = [];
    const seen = new Set<string>();
    const addMethod = (method: any): void => {
        if (!method || !method.getCfg || !method.getCfg()) return;
        const sig = method.getSignature?.().toString?.();
        if (!sig || seen.has(sig)) return;
        seen.add(sig);
        out.push({ method, reason: "type_fallback" });
    };

    const multipleKeyCandidates = keyParamIndexes.length >= 2;
    for (const cs of incomingCallSitesStable) {
        const callStmt = cs.callStmt;
        const callInvokeExpr = callStmt?.getInvokeExpr?.();
        if (!callInvokeExpr) continue;

        const explicitArgs = cs.args || (callInvokeExpr.getArgs ? callInvokeExpr.getArgs() : []);
        const argToParamPairs = mapInvokeArgsToParamAssigns(callInvokeExpr, explicitArgs, calleeParamStmts);
        if (argToParamPairs.length === 0) continue;

        const argByParamIndex = new Map<number, any>();
        for (const pair of argToParamPairs) {
            if (!argByParamIndex.has(pair.paramIndex)) {
                argByParamIndex.set(pair.paramIndex, pair.arg);
            }
        }
        const objectArg = argByParamIndex.get(baseParamIndex);
        if (!objectArg) continue;

        const callerMethodSig = cs.callStmt?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
        const callerFile = extractFilePathFromSignature(callerMethodSig);

        const orderedCandidates = rankKeyParamCandidates(keyParamIndexes, argByParamIndex);
        for (const keyCandidate of orderedCandidates) {
            const keyParamIndex = keyCandidate.paramIndex;
            if (multipleKeyCandidates && keyCandidate.evidenceScore <= 0) {
                // 7.8.3 P3 hardening: when multiple key candidates exist and no string/type hint,
                // keep safe degrade (do not connect by guess).
                continue;
            }
            const keyArg = argByParamIndex.get(keyParamIndex);
            const keyLiteral = resolveStringLiteralByLocalBacktrace(keyArg);
            let methods: any[] = [];
            if (keyLiteral) {
                methods = resolveMethodsByPropertyName(scene, keyLiteral, callerFile, context);
                if (methods.length === 0) {
                    methods = resolveMethodsFromAnonymousObjectCarrierByField(scene, objectArg, keyLiteral);
                }
            }
            if (methods.length === 0 && !multipleKeyCandidates) {
                methods = resolveMethodsFromAnonymousObjectCarrier(scene, objectArg);
            }
            for (const m of methods) addMethod(m);
        }
    }

    if (out.length > 8) return [];
    return out;
}

function resolveMethodsByPropertyName(
    scene: Scene,
    propertyName: string,
    sourceFile: string,
    context?: SyntheticInvokeLookupContext
): any[] {
    if (context) {
        context.stats.methodLookupCalls++;
    }
    const normalizedTarget = normalizeMethodNameForMatch(propertyName);
    const fileKey = sourceFile || "__all__";
    const lookupKey = `${fileKey}::${normalizedTarget}`;
    if (context?.methodLookupCacheByFileAndProperty.has(lookupKey)) {
        context.stats.methodLookupCacheHits++;
        return [...(context.methodLookupCacheByFileAndProperty.get(lookupKey) || [])];
    }

    const out: any[] = [];
    const seen = new Set<string>();
    const pushMethod = (m: any): void => {
        if (!m || !m.getCfg || !m.getCfg()) return;
        const sig = m.getSignature?.().toString?.();
        if (!sig || seen.has(sig)) return;
        seen.add(sig);
        out.push(m);
    };

    const methods = getMethodsByFileCached(scene, sourceFile, context);
    for (const method of methods) {
        const sig = method.getSignature?.().toString?.() || "";
        if (!sig) continue;

        const methodName = method.getName?.() || "";
        const normalizedMethodName = normalizeMethodNameForMatch(methodName);
        if (normalizedMethodName === normalizedTarget) {
            pushMethod(method);
            continue;
        }
        if (methodName.startsWith("%AM") && methodName.includes(`$${propertyName}`)) {
            pushMethod(method);
        }
    }

    if (context) {
        context.methodLookupCacheByFileAndProperty.set(lookupKey, [...out]);
    }
    return out;
}

function getMethodsByFileCached(
    scene: Scene,
    sourceFile: string,
    context?: SyntheticInvokeLookupContext
): any[] {
    if (!context) {
        return scene.getMethods().filter(m => {
            if (!sourceFile) return true;
            const sig = m.getSignature?.().toString?.() || "";
            return !!sig && extractFilePathFromSignature(sig) === sourceFile;
        });
    }
    const fileKey = sourceFile || "__all__";
    if (context.methodsByFileCache.has(fileKey)) {
        return context.methodsByFileCache.get(fileKey)!;
    }
    const list = scene.getMethods().filter(m => {
        if (!sourceFile) return true;
        const sig = m.getSignature?.().toString?.() || "";
        return !!sig && extractFilePathFromSignature(sig) === sourceFile;
    });
    context.methodsByFileCache.set(fileKey, list);
    return list;
}

function rankKeyParamCandidates(
    keyParamIndexes: number[],
    argByParamIndex: Map<number, any>
): Array<{ paramIndex: number; evidenceScore: number }> {
    const scored = keyParamIndexes.map(paramIndex => {
        const arg = argByParamIndex.get(paramIndex);
        const literal = resolveStringLiteralByLocalBacktrace(arg);
        let evidenceScore = 0;
        if (literal) evidenceScore += 10;
        if (hasStringTypeHint(arg)) evidenceScore += 3;
        return { paramIndex, evidenceScore };
    });
    scored.sort((a, b) => b.evidenceScore - a.evidenceScore || a.paramIndex - b.paramIndex);
    return scored;
}

function hasStringTypeHint(value: any): boolean {
    const typeText = String(value?.getType?.()?.toString?.() || "").toLowerCase();
    if (!typeText) return false;
    return typeText.includes("string");
}

function resolveMethodsFromAnonymousObjectCarrier(scene: Scene, objectValue: any): any[] {
    const classSig = objectValue?.getType?.()?.getClassSignature?.()?.toString?.() || "";
    if (!classSig) return [];
    if (!isAnonymousObjectCarrierClassSignature(classSig)) return [];

    const out: any[] = [];
    const seen = new Set<string>();
    for (const method of scene.getMethods()) {
        const declaringClassSig = method.getDeclaringArkClass?.()?.getSignature?.()?.toString?.() || "";
        if (declaringClassSig !== classSig) continue;
        const name = method.getName?.() || "";
        if (!name.startsWith("%AM")) continue;
        if (!method.getCfg || !method.getCfg()) continue;
        const sig = method.getSignature?.().toString?.();
        if (!sig || seen.has(sig)) continue;
        seen.add(sig);
        out.push(method);
    }
    if (out.length > 8) return [];
    return out;
}

function resolveMethodsFromAnonymousObjectCarrierByField(
    scene: Scene,
    objectValue: any,
    fieldName: string
): any[] {
    const classSig = objectValue?.getType?.()?.getClassSignature?.()?.toString?.() || "";
    if (!classSig) return [];
    if (!isAnonymousObjectCarrierClassSignature(classSig)) return [];

    const out: any[] = [];
    const seen = new Set<string>();
    const addResolvedMethods = (callableValue: any): void => {
        const methods = resolveMethodsFromCallable(scene, callableValue, { maxCandidates: 8 });
        for (const method of methods) {
            if (!method || !method.getCfg || !method.getCfg()) continue;
            const sig = method.getSignature?.().toString?.();
            if (!sig || seen.has(sig)) continue;
            seen.add(sig);
            out.push(method);
        }
    };

    for (const method of scene.getMethods()) {
        const declaringClassSig = method.getDeclaringArkClass?.()?.getSignature?.()?.toString?.() || "";
        if (declaringClassSig !== classSig) continue;
        const name = method.getName?.() || "";
        if (!(name.includes("constructor(") || name.includes("%instInit"))) continue;
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            if (!(left instanceof ArkInstanceFieldRef)) continue;
            const leftBase = left.getBase?.();
            if (!(leftBase instanceof Local) || leftBase.getName() !== "this") continue;
            const leftFieldName = left.getFieldSignature?.().getFieldName?.() || "";
            if (leftFieldName !== fieldName) continue;
            addResolvedMethods(stmt.getRightOp());
        }
    }

    if (out.length > 8) return [];
    return out;
}

function isAnonymousObjectCarrierClassSignature(classSig: string): boolean {
    if (!classSig) return false;
    return /(^|[.: \t])%AC\d+\$/.test(classSig) || classSig.includes(": %AC");
}

function normalizeMethodNameForMatch(name: string): string {
    return String(name || "").replace(/^\[static\]/, "").trim();
}

function resolveStringLiteralByLocalBacktrace(value: any): string | undefined {
    const direct = extractStringLiteral(value);
    if (direct) return direct;
    if (!(value instanceof Local)) return undefined;

    const MAX_BACKTRACE_STEPS = 5;
    const MAX_VISITED_DEFS = 16;
    const rootMethodSig = value.getDeclaringStmt?.()?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
    if (!rootMethodSig) return undefined;

    let current: any = value;
    let steps = 0;
    const visitedDefs = new Set<string>();
    while (steps < MAX_BACKTRACE_STEPS && current instanceof Local) {
        const declStmt = current.getDeclaringStmt?.();
        if (!(declStmt instanceof ArkAssignStmt)) break;
        if (declStmt.getLeftOp() !== current) break;

        const declMethodSig = declStmt.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
        if (!declMethodSig || declMethodSig !== rootMethodSig) break;

        const identity = `${current.getName?.() || ""}#${declStmt.getOriginPositionInfo?.()?.getLineNo?.() || -1}#${declStmt.toString?.() || ""}`;
        if (visitedDefs.has(identity)) break;
        visitedDefs.add(identity);
        if (visitedDefs.size > MAX_VISITED_DEFS) break;

        const rightOp = declStmt.getRightOp();
        const lit = extractStringLiteral(rightOp);
        if (lit) return lit;
        if (!(rightOp instanceof Local)) break;
        current = rightOp;
        steps++;
    }
    return undefined;
}

function extractStringLiteral(value: any): string | undefined {
    if (value === undefined || value === null) return undefined;
    const text = String(value?.toString?.() || "").trim();
    if (!text) return undefined;
    const m = text.match(/^["'`](.+)["'`]$/);
    if (!m) return undefined;
    return m[1];
}

function resolveCallbackParameterIndexInCurrentMethod(callerMethod: any, callbackArg: any): number | undefined {
    if (callbackArg instanceof ArkParameterRef) {
        return callbackArg.getIndex();
    }
    if (!(callbackArg instanceof Local)) return undefined;

    const rootMethodSig = callerMethod?.getSignature?.().toString?.() || "";
    if (!rootMethodSig) return undefined;

    const MAX_BACKTRACE_STEPS = 5;
    const MAX_VISITED_DEFS = 16;
    let current: any = callbackArg;
    let steps = 0;
    const visitedDefs = new Set<string>();
    while (steps < MAX_BACKTRACE_STEPS && current instanceof Local) {
        const declStmt = current.getDeclaringStmt?.();
        if (!(declStmt instanceof ArkAssignStmt)) break;
        if (declStmt.getLeftOp() !== current) break;

        const declMethodSig = declStmt.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
        if (!declMethodSig || declMethodSig !== rootMethodSig) break;

        const defIdentity = `${current.getName?.() || ""}#${declStmt.getOriginPositionInfo?.()?.getLineNo?.() || -1}#${declStmt.toString?.() || ""}`;
        if (visitedDefs.has(defIdentity)) break;
        visitedDefs.add(defIdentity);
        if (visitedDefs.size > MAX_VISITED_DEFS) break;

        const rightOp = declStmt.getRightOp();
        if (rightOp instanceof ArkParameterRef) return rightOp.getIndex();
        if (!(rightOp instanceof Local)) break;

        current = rightOp;
        steps++;
    }

    return undefined;
}

function extractFilePathFromSignature(signature: string): string {
    const m = signature.match(/@([^:>]+):/);
    return m ? m[1].replace(/\\/g, "/") : "";
}

function extractLineNoFromSignature(signature: string): number {
    const m = signature.match(/@[^:>]+:(\d+):\d+>/);
    if (!m) return Number.MAX_SAFE_INTEGER;
    const parsed = Number(m[1]);
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

interface CallbackCapturedValueMapping {
    callbackValue: any;
    callerLocalName: string;
    anchorStmt?: any;
}

function collectCallbackCapturedLocalMappings(
    callbackMethod: any,
    paramStmts: ArkAssignStmt[]
): CallbackCapturedValueMapping[] {
    const cfg = callbackMethod.getCfg?.();
    if (!cfg) return [];
    const callbackClassSig = callbackMethod.getDeclaringArkClass?.()?.getSignature?.()?.toString?.() || "";
    const allowDirectCapturedLocals = isAnonymousObjectCarrierClassSignature(callbackClassSig);

    const carrierLocalNames = new Set<string>();
    for (const pStmt of paramStmts) {
        const left = pStmt.getLeftOp();
        if (left instanceof Local) {
            carrierLocalNames.add(left.getName());
        }
    }

    const out: CallbackCapturedValueMapping[] = [];
    const seen = new Set<string>();
    for (const stmt of cfg.getStmts()) {
        if (stmt instanceof ArkAssignStmt) {
            const left = stmt.getLeftOp();
            const right = stmt.getRightOp();
            if (!(left instanceof Local) || (!(right instanceof ArkInstanceFieldRef) && !(right instanceof ClosureFieldRef))) continue;

            const base = right.getBase();
            if (!(base instanceof Local)) continue;
            const isLikelyClosureCarrier = base.getName().startsWith("%closures") || (right instanceof ClosureFieldRef);
            if (!carrierLocalNames.has(base.getName()) && !isLikelyClosureCarrier) continue;

            const fallbackName = right instanceof ArkInstanceFieldRef
                ? right.getFieldSignature().getFieldName()
                : right.getFieldName();
            const callerLocalName = fallbackName || left.getName();
            const key = `assign|${left.getName()}|${callerLocalName}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
                callbackValue: left,
                callerLocalName,
                anchorStmt: stmt,
            });
            continue;
        }

        if (allowDirectCapturedLocals && stmt instanceof ArkAssignStmt) {
            const right = stmt.getRightOp();
            if (right instanceof Local && isDirectCapturedLocalReference(right)) {
                const callerLocalName = right.getName();
                const key = `assign-local|${callerLocalName}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    out.push({
                        callbackValue: right,
                        callerLocalName,
                        anchorStmt: stmt,
                    });
                }
            }
        }

        if (!stmt.containsInvokeExpr?.()) continue;
        const invokeExpr = stmt.getInvokeExpr?.();
        if (!invokeExpr) continue;
        const invokeArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        for (const invokeArg of invokeArgs) {
            if (!(invokeArg instanceof ArkInstanceFieldRef) && !(invokeArg instanceof ClosureFieldRef)) continue;
            const base = invokeArg.getBase?.();
            if (!(base instanceof Local)) continue;
            const isLikelyClosureCarrier = base.getName().startsWith("%closures") || (invokeArg instanceof ClosureFieldRef);
            if (!carrierLocalNames.has(base.getName()) && !isLikelyClosureCarrier) continue;

            const fallbackName = invokeArg instanceof ArkInstanceFieldRef
                ? invokeArg.getFieldSignature().getFieldName()
                : invokeArg.getFieldName();
            const callerLocalName = fallbackName || String(invokeArg.toString?.() || "");
            const key = `invoke|${String(invokeArg.toString?.() || "")}|${callerLocalName}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
                callbackValue: invokeArg,
                callerLocalName,
                anchorStmt: stmt,
            });
        }

        if (!allowDirectCapturedLocals) continue;
        for (const invokeArg of invokeArgs) {
            if (!(invokeArg instanceof Local) || !isDirectCapturedLocalReference(invokeArg)) continue;
            const callerLocalName = invokeArg.getName();
            const key = `invoke-local|${callerLocalName}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
                callbackValue: invokeArg,
                callerLocalName,
                anchorStmt: stmt,
            });
        }
    }
    return out;
}

function isDirectCapturedLocalReference(value: Local): boolean {
    const localName = value.getName?.() || "";
    if (!localName || localName === "this" || localName.startsWith("%")) return false;
    return !value.getDeclaringStmt?.();
}
