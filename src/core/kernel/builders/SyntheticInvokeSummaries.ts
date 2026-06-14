import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { CallGraph } from "../../../../arkanalyzer/out/src/callgraph/model/CallGraph";
import { Pag, PagNode, PagStaticFieldNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkParameterRef, ArkInstanceFieldRef, ArkStaticFieldRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { ArkInstanceInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { getMethodBySignature } from "../contracts/MethodLookup";
import { safeGetOrCreatePagNodes } from "../contracts/PagNodeResolution";
import type {
    SyntheticConstructorStoreInfo,
    SyntheticFieldBridgeInfo,
    SyntheticStaticInitStoreInfo,
} from "./SyntheticInvokeEdgeBuilder";

interface ConstructorCapturedStore {
    targetFieldName: string;
    sourceFieldPath?: string[];
}

export function buildSyntheticConstructorStoreMap(
    scene: Scene,
    _cg: CallGraph,
    pag: Pag,
    log: (msg: string) => void
): Map<number, SyntheticConstructorStoreInfo[]> {
    const map = new Map<number, SyntheticConstructorStoreInfo[]>();
    const summaryCache = new Map<string, Map<number, Set<string>>>();
    const visiting = new Set<string>();
    const capturedSummaryCache = new Map<string, Map<string, ConstructorCapturedStore[]>>();
    const capturedVisiting = new Set<string>();
    let count = 0;

    for (const caller of scene.getMethods()) {
        const cfg = caller.getCfg();
        if (!cfg) continue;

        for (const stmt of cfg.getStmts()) {
            if (!stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;

            const calleeSig = invokeExpr.getMethodSignature().toString();
            if (!calleeSig || calleeSig.includes("%unk") || !calleeSig.includes(".constructor(")) continue;

            const callee = getMethodBySignature(scene, calleeSig);
            if (!callee || !callee.getCfg()) continue;

            const summary = summarizeConstructorParamToFields(scene, callee, summaryCache, visiting);
            const capturedSummary = summarizeConstructorCapturedLocalStores(
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
                const srcNodes = pag.getNodesByValue(srcArg) || safeGetOrCreatePagNodes(pag, srcArg, stmt);
                if (!srcNodes || srcNodes.size === 0) continue;

                for (const srcNodeId of srcNodes.values()) {
                    const sourceCarrierIds = collectSourceCarrierIds(pag.getNode(srcNodeId) as PagNode | undefined, srcNodeId);
                    for (const baseNodeId of baseNodes.values()) {
                        const baseNode = pag.getNode(baseNodeId) as PagNode;
                        for (const objId of collectCarrierObjectIds(baseNode)) {
                            for (const fieldName of fieldNames) {
                                for (const sourceCarrierId of sourceCarrierIds) {
                                    pushCtorStore(map, sourceCarrierId, { srcNodeId: sourceCarrierId, objId, fieldName });
                                    count++;
                                }
                            }
                        }
                    }
                }
            }

            if (capturedSummary.size > 0) {
                const callerLocals = caller.getBody?.()?.getLocals?.();
                if (callerLocals) {
                    for (const [capturedLocalName, stores] of capturedSummary.entries()) {
                        const callerLocal = callerLocals.get(capturedLocalName);
                        if (!(callerLocal instanceof Local)) continue;
                        const srcNodes = pag.getNodesByValue(callerLocal);
                        if (!srcNodes || srcNodes.size === 0) continue;

                        for (const srcNodeId of srcNodes.values()) {
                            const sourceCarrierIds = collectSourceCarrierIds(pag.getNode(srcNodeId) as PagNode | undefined, srcNodeId);
                            for (const baseNodeId of baseNodes.values()) {
                                const baseNode = pag.getNode(baseNodeId) as PagNode;
                                for (const objId of collectCarrierObjectIds(baseNode)) {
                                    for (const store of stores) {
                                        for (const sourceCarrierId of sourceCarrierIds) {
                                            pushCtorStore(map, sourceCarrierId, {
                                                srcNodeId: sourceCarrierId,
                                                objId,
                                                fieldName: store.targetFieldName,
                                                sourceFieldPath: store.sourceFieldPath ? [...store.sourceFieldPath] : undefined,
                                            });
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
    const storeCache = new Map<string, Map<string, ConstructorCapturedStore[]>>();
    const storeSummary = summarizeConstructorCapturedLocalStores(scene, method, storeCache, visiting);
    const result = new Map<string, Set<string>>();
    for (const [localName, stores] of storeSummary.entries()) {
        if (!result.has(localName)) result.set(localName, new Set<string>());
        for (const store of stores) result.get(localName)!.add(store.targetFieldName);
    }
    cache.set(sig, result);
    return result;
}

function summarizeConstructorCapturedLocalStores(
    scene: Scene,
    method: any,
    cache: Map<string, Map<string, ConstructorCapturedStore[]>>,
    visiting: Set<string>
): Map<string, ConstructorCapturedStore[]> {
    const sig = method.getSignature().toString();
    if (cache.has(sig)) return cache.get(sig)!;
    if (visiting.has(sig)) return new Map();
    visiting.add(sig);

    const result = new Map<string, Map<string, ConstructorCapturedStore>>();
    const cfg = method.getCfg();
    if (!cfg) {
        visiting.delete(sig);
        const empty = new Map<string, ConstructorCapturedStore[]>();
        cache.set(sig, empty);
        return empty;
    }

    const paramLocalNames = new Set<string>();
    const localCapturedAliases = new Map<string, { localName: string; sourceFieldPath?: string[] }>();
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (left instanceof Local && right instanceof ArkParameterRef) {
            paramLocalNames.add(left.getName());
        }
    }

    const resolveCapturedLocalSource = (value: any): { localName: string; sourceFieldPath?: string[] } | undefined => {
        if (value instanceof Local) {
            const localName = value.getName();
            if (!localName || localName === "this" || paramLocalNames.has(localName)) {
                return undefined;
            }
            return localCapturedAliases.get(localName) || (localName.startsWith("%") ? undefined : { localName });
        }
        if (value instanceof ArkInstanceFieldRef) {
            const base = value.getBase();
            if (!(base instanceof Local)) return undefined;
            const baseName = base.getName();
            if (!baseName || baseName === "this" || paramLocalNames.has(baseName)) {
                return undefined;
            }
            const fieldName = value.getFieldSignature?.().getFieldName?.() || value.getFieldName?.();
            if (!fieldName) return undefined;
            const baseAlias = localCapturedAliases.get(baseName);
            if (baseAlias) {
                return {
                    localName: baseAlias.localName,
                    sourceFieldPath: [...(baseAlias.sourceFieldPath || []), fieldName],
                };
            }
            return baseName.startsWith("%")
                ? undefined
                : { localName: baseName, sourceFieldPath: [fieldName] };
        }
        return undefined;
    };

    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();

        if (left instanceof Local) {
            const captured = resolveCapturedLocalSource(right);
            if (captured) {
                localCapturedAliases.set(left.getName(), captured);
            }
        }

        if (!(left instanceof ArkInstanceFieldRef)) continue;
        const leftBase = left.getBase();
        if (!(leftBase instanceof Local) || leftBase.getName() !== "this") continue;

        const source = resolveCapturedLocalSource(right);
        if (!source) continue;

        const fieldName = left.getFieldSignature().getFieldName();
        const byTargetField = result.get(source.localName) || new Map<string, ConstructorCapturedStore>();
        const key = `${fieldName}\u0001${(source.sourceFieldPath || []).join(".")}`;
        byTargetField.set(key, {
            targetFieldName: fieldName,
            sourceFieldPath: source.sourceFieldPath ? [...source.sourceFieldPath] : undefined,
        });
        result.set(source.localName, byTargetField);
    }

    for (const stmt of cfg.getStmts()) {
        if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
        const invokeExpr = stmt.getInvokeExpr();
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
        const calleeSig = invokeExpr.getMethodSignature().toString();
        if (!calleeSig || calleeSig.includes("%unk")) continue;
        if (!calleeSig.includes(".constructor(") && !calleeSig.includes("%instInit")) continue;
        const callee = getMethodBySignature(scene, calleeSig);
        if (!callee || !callee.getCfg()) continue;
        const nested = summarizeConstructorCapturedLocalStores(scene, callee, cache, visiting);
        for (const [localName, stores] of nested.entries()) {
            const byTargetField = result.get(localName) || new Map<string, ConstructorCapturedStore>();
            for (const store of stores) {
                const key = `${store.targetFieldName}\u0001${(store.sourceFieldPath || []).join(".")}`;
                byTargetField.set(key, {
                    targetFieldName: store.targetFieldName,
                    sourceFieldPath: store.sourceFieldPath ? [...store.sourceFieldPath] : undefined,
                });
            }
            result.set(localName, byTargetField);
        }
    }

    visiting.delete(sig);
    const normalized = new Map([...result.entries()].map(([localName, stores]) => [localName, [...stores.values()]]));
    cache.set(sig, normalized);
    return normalized;
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

        const callerThisNodes = pag.getNodesByValue(callerThisLocal)
            || safeGetOrCreatePagNodes(pag, callerThisLocal, callerThisLocal.getDeclaringStmt?.());
        if (!callerThisNodes || callerThisNodes.size === 0) continue;
        const callerObjectIds = new Set<number>();
        for (const thisNodeId of callerThisNodes.values()) {
            const thisNode = pag.getNode(thisNodeId) as PagNode;
            for (const objId of collectCarrierObjectIds(thisNode)) {
                callerObjectIds.add(objId);
            }
        }
        if (callerObjectIds.size === 0) continue;

        for (const stmt of cfg.getStmts()) {
            if (stmt instanceof ArkAssignStmt) {
                const left = stmt.getLeftOp();
                const right = stmt.getRightOp();
                if (left instanceof ArkInstanceFieldRef && right instanceof Local) {
                    const leftBase = left.getBase();
                    if (leftBase instanceof Local && leftBase.getName() === "this") {
                        const targetFieldName = left.getFieldSignature().getFieldName();
                        const sourceFieldNames = summarizeConstructedLocalFieldNames(scene, right, summaryCache, visiting);
                        if (sourceFieldNames.size > 0) {
                            const rightNodes = pag.getNodesByValue(right) || safeGetOrCreatePagNodes(pag, right, stmt);
                            if (rightNodes && rightNodes.size > 0) {
                                for (const rightNodeId of rightNodes.values()) {
                                    const rightNode = pag.getNode(rightNodeId) as PagNode;
                                    const sourceObjectNodeIds = collectCarrierObjectIds(rightNode);
                                    for (const sourceObjectNodeId of sourceObjectNodeIds) {
                                        for (const targetObjectNodeId of callerObjectIds) {
                                            for (const sourceFieldName of sourceFieldNames) {
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
                    }
                }
            }

            if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;

            const calleeSig = invokeExpr.getMethodSignature().toString();
            if (!calleeSig || !calleeSig.includes(".constructor(")) continue;
            if (!calleeSig.includes("%AC")) continue;

            const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            if (args.length > 0) continue;

            const callee = getMethodBySignature(scene, calleeSig);
            if (!callee || !callee.getCfg()) continue;

            let fieldCopySummary = summarizeThisFieldCopyMap(scene, callee, summaryCache, visiting);
            if (fieldCopySummary.size === 0) {
                const instInitMethod = resolveCompanionInstInitMethod(scene, callee);
                if (instInitMethod) {
                    fieldCopySummary = summarizeThisFieldCopyMap(scene, instInitMethod, summaryCache, visiting);
                }
            }
            if (fieldCopySummary.size === 0) continue;

            const base = invokeExpr.getBase();
            const baseNodes = pag.getNodesByValue(base) || safeGetOrCreatePagNodes(pag, base, stmt);
            if (!baseNodes || baseNodes.size === 0) continue;
            const targetObjectIds = new Set<number>();
            for (const baseNodeId of baseNodes.values()) {
                const baseNode = pag.getNode(baseNodeId) as PagNode;
                for (const objId of collectCarrierObjectIds(baseNode)) {
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

function summarizeConstructedLocalFieldNames(
    scene: Scene,
    local: Local,
    cache: Map<string, Map<string, Set<string>>>,
    visiting: Set<string>,
): Set<string> {
    const typeText = String(local.getType?.()?.toString?.() || "").trim();
    if (!typeText || typeText.includes("%unk")) {
        return new Set();
    }
    const initMethod = getMethodBySignature(scene, `${typeText}.%instInit()`);
    if (!initMethod || !initMethod.getCfg?.()) {
        return new Set();
    }
    return summarizeThisAssignedFieldNames(scene, initMethod, cache, visiting);
}

function summarizeThisAssignedFieldNames(
    scene: Scene,
    method: any,
    cache: Map<string, Map<string, Set<string>>>,
    visiting: Set<string>,
): Set<string> {
    const sig = method.getSignature().toString();
    const cacheKey = `__fields__:${sig}`;
    const cached = cache.get(cacheKey);
    if (cached) return new Set(cached.get("__fields__") || []);
    if (visiting.has(cacheKey)) return new Set();
    visiting.add(cacheKey);

    const fields = new Set<string>();
    const cfg = method.getCfg?.();
    if (cfg) {
        for (const stmt of cfg.getStmts()) {
            if (stmt instanceof ArkAssignStmt) {
                const left = stmt.getLeftOp();
                if (left instanceof ArkInstanceFieldRef) {
                    const base = left.getBase();
                    if (base instanceof Local && base.getName() === "this") {
                        const fieldName = left.getFieldSignature().getFieldName();
                        if (fieldName) fields.add(fieldName);
                    }
                }
            }

            if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
            const calleeSig = invokeExpr.getMethodSignature().toString();
            if (!calleeSig || calleeSig.includes("%unk")) continue;
            if (!calleeSig.includes(".constructor(") && !calleeSig.includes("%instInit")) continue;
            const callee = getMethodBySignature(scene, calleeSig);
            if (!callee || !callee.getCfg?.()) continue;
            for (const fieldName of summarizeThisAssignedFieldNames(scene, callee, cache, visiting)) {
                fields.add(fieldName);
            }
        }
    }

    visiting.delete(cacheKey);
    const stored = new Map<string, Set<string>>();
    stored.set("__fields__", fields);
    cache.set(cacheKey, stored);
    return new Set(fields);
}

export function buildSyntheticStaticInitStoreMap(
    scene: Scene,
    _cg: CallGraph,
    pag: Pag,
    log: (msg: string) => void,
): Map<number, SyntheticStaticInitStoreInfo[]> {
    const map = new Map<number, SyntheticStaticInitStoreInfo[]>();
    const staticFieldNodeIdsByKey = buildStaticFieldNodeIdsByKey(pag);
    let count = 0;

    for (const statInitMethod of scene.getMethods()) {
        if (statInitMethod.getName?.() !== "%statInit") continue;
        const outerMethod = resolveEnclosingMethodForLocalClassStatInit(scene, statInitMethod);
        if (!outerMethod) continue;

        const capturedLocalToStaticFields = summarizeStaticInitCapturedLocalToStaticFields(statInitMethod);
        if (capturedLocalToStaticFields.size === 0) continue;

        const outerLocals = outerMethod.getBody?.()?.getLocals?.();
        if (!outerLocals) continue;

        for (const [localName, staticFieldKeys] of capturedLocalToStaticFields.entries()) {
            const outerLocal = outerLocals.get(localName);
            if (!(outerLocal instanceof Local)) continue;
            const srcNodes = pag.getNodesByValue(outerLocal);
            if (!srcNodes || srcNodes.size === 0) continue;

            for (const staticFieldKey of staticFieldKeys) {
                const targetNodeIds = staticFieldNodeIdsByKey.get(staticFieldKey);
                if (!targetNodeIds || targetNodeIds.size === 0) continue;
                for (const srcNodeId of srcNodes.values()) {
                    for (const staticFieldNodeId of targetNodeIds.values()) {
                        pushStaticInitStore(map, srcNodeId, {
                            srcNodeId,
                            staticFieldNodeId,
                        });
                        count++;
                    }
                }
            }
        }
    }

    log(`Synthetic Static Init Store Map Built: ${count} static-init transfers.`);
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

        const callee = getMethodBySignature(scene, calleeSig);
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
                    mergeEdge(
                        right.getFieldSignature().getFieldName(),
                        left.getFieldSignature().getFieldName(),
                    );
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

        const callee = getMethodBySignature(scene, calleeSig);
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

function resolveCompanionInstInitMethod(scene: Scene, constructorMethod: any): any | undefined {
    const classSignature = constructorMethod
        ?.getDeclaringArkClass?.()
        ?.getSignature?.()
        ?.toString?.();
    if (classSignature) {
        const byClassSignature = getMethodBySignature(scene, `${classSignature}.%instInit()`);
        if (byClassSignature?.getCfg?.()) return byClassSignature;
    }

    const constructorSig = constructorMethod?.getSignature?.()?.toString?.() || "";
    const bySignatureText = constructorSig.replace(/\.constructor\([^)]*\)$/, ".%instInit()");
    if (bySignatureText !== constructorSig) {
        const method = getMethodBySignature(scene, bySignatureText);
        if (method?.getCfg?.()) return method;
    }
    return undefined;
}

function summarizeStaticInitCapturedLocalToStaticFields(method: any): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    const cfg = method?.getCfg?.();
    if (!cfg) return result;

    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof ArkStaticFieldRef)) continue;
        if (!(right instanceof Local)) continue;

        const localName = right.getName?.() || "";
        if (!localName || localName.startsWith("%")) continue;
        const staticFieldKey = left.toString?.() || "";
        if (!staticFieldKey) continue;

        if (!result.has(localName)) result.set(localName, new Set<string>());
        result.get(localName)!.add(staticFieldKey);
    }

    return result;
}

function buildStaticFieldNodeIdsByKey(pag: Pag): Map<string, Set<number>> {
    const result = new Map<string, Set<number>>();
    for (const rawNode of pag.getNodesIter()) {
        const node = rawNode as PagNode;
        if (!(node instanceof PagStaticFieldNode)) continue;
        const key = node.getValue?.()?.toString?.() || "";
        if (!key) continue;
        if (!result.has(key)) result.set(key, new Set<number>());
        result.get(key)!.add(node.getID());
    }
    return result;
}

function resolveEnclosingMethodForLocalClassStatInit(scene: Scene, statInitMethod: any): any | undefined {
    const className = statInitMethod?.getDeclaringArkClass?.()?.getName?.() || "";
    const methodSig = statInitMethod?.getSignature?.()?.toString?.() || "";
    const filePath = extractFilePathFromMethodSignature(methodSig);
    if (!className || !filePath) return undefined;

    const marker = "$%dflt-";
    const markerIndex = className.indexOf(marker);
    if (markerIndex < 0) return undefined;
    const outerMethodName = className.slice(markerIndex + marker.length);
    if (!outerMethodName) return undefined;

    return scene.getMethods().find(candidate => (
        candidate.getName?.() === outerMethodName
        && candidate.getSignature?.()?.toString?.().includes(filePath)
    ));
}

function extractFilePathFromMethodSignature(methodSig: string): string {
    const trimmed = methodSig.trim();
    if (!trimmed.startsWith("@")) return "";
    const colonIndex = trimmed.indexOf(":");
    return colonIndex > 1 ? trimmed.slice(0, colonIndex) : "";
}

function pushCtorStore(map: Map<number, SyntheticConstructorStoreInfo[]>, key: number, info: SyntheticConstructorStoreInfo): void {
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(info);
}

function collectSourceCarrierIds(sourceNode: PagNode | undefined, fallbackNodeId: number): number[] {
    const ids = new Set<number>();
    ids.add(fallbackNodeId);
    if (sourceNode?.getPointTo) {
        for (const objId of sourceNode.getPointTo()) {
            ids.add(objId);
        }
    }
    return [...ids.values()];
}

function pushStaticInitStore(map: Map<number, SyntheticStaticInitStoreInfo[]>, key: number, info: SyntheticStaticInitStoreInfo): void {
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(info);
}

function collectCarrierObjectIds(baseNode: PagNode): number[] {
    const ids = [...baseNode.getPointTo()];
    if (ids.length > 0) return ids;
    return [baseNode.getID()];
}
