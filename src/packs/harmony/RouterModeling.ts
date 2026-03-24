import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { Pag, PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../arkanalyzer/out/src/core/base/Expr";
import { ArkParameterRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { ArkInstanceFieldRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import {
    BuildRouterSemanticModelArgs,
    RouterSemanticModel,
    RouterValueFieldTarget,
} from "../../core/kernel/contracts/RouterModelingProvider";
import {
    collectFiniteStringCandidatesFromValue,
    collectParameterAssignStmts,
    resolveMethodsFromCallable,
} from "../../core/kernel/contracts/SemanticPack";
import { addMapSetValue, resolveClassKeyFromMethodSig, resolveHarmonyMethods } from "../../core/kernel/contracts/HarmonyModelingUtils";

export type RouterModel = RouterSemanticModel;
export type BuildRouterModelArgs = BuildRouterSemanticModelArgs;

const KNOWN_ROUTER_PUSH_METHODS = new Set([
    "pushUrl",
    "replaceUrl",
    "pushNamedRoute",
    "pushPath",
    "pushPathByName",
    "replacePath",
]);
const KNOWN_ROUTER_GET_METHODS = new Set(["getParams"]);
const KNOWN_NAV_DESTINATION_CLASS_NAMES = new Set(["NavDestination"]);
const KNOWN_NAV_DESTINATION_REGISTER_METHODS = new Set(["register", "setBuilder", "setDestinationBuilder"]);
const FRAMEWORK_SIGNATURE_HINTS = ["@ohos", "@ohossdk", "ohos.router", "ohos/router"];

interface RouterClassProfile {
    classKey: string;
    classSigText: string;
    className: string;
    hasPush: boolean;
    hasGet: boolean;
    hasFrameworkMarker: boolean;
}

export function buildRouterModel(args: BuildRouterModelArgs): RouterModel {
    const pushArgNodeIdsByRouterKey = new Map<string, Set<number>>();
    const pushArgNodeIdToRouterKeys = new Map<number, Set<string>>();
    const pushFieldEndpointToRouterKeys = new Map<string, Set<string>>();
    const pushValueFieldTargetsByNodeId = new Map<number, RouterValueFieldTarget[]>();
    const getResultNodeIdsByRouterKey = new Map<string, Set<number>>();
    const getResultObjectNodeIdsByRouterKey = new Map<string, Set<number>>();
    const ungroupedPushNodeIds = new Set<number>();
    const ungroupedPushFieldEndpoints = new Set<string>();
    const pushCallCountByRouterKey = new Map<string, number>();
    const routeKeysByRouterKey = new Map<string, Set<string>>();

    let pushCallCount = 0;
    let getCallCount = 0;
    let suspiciousCallCount = 0;
    const instInitPayloadSummaryCache = new Map<string, InstInitPayloadSummary>();
    const routerClassProfiles = buildRouterClassProfiles(args.scene);
    const suspiciousLogs = new Set<string>();

    const methods = resolveHarmonyMethods(args.scene, args.allowedMethodSignatures);
    for (const method of methods) {
        const cfg = method.getCfg();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!(invokeExpr instanceof ArkStaticInvokeExpr || invokeExpr instanceof ArkInstanceInvokeExpr)) {
                continue;
            }
            const invokeMethodSig = invokeExpr.getMethodSignature?.();
            if (!invokeMethodSig) continue;
            const invokeMethodName = invokeMethodSig.getMethodSubSignature?.()?.getMethodName?.() || "";
            const pushRouterKey = resolveRouterPushIntent(
                invokeMethodSig,
                invokeMethodName,
                routerClassProfiles,
                suspiciousLogs,
                args.log
            );
            if (pushRouterKey) {
                pushCallCount++;
                incrementCounter(pushCallCountByRouterKey, pushRouterKey);
                const payload = collectPushPayload(
                    args.scene,
                    method,
                    invokeExpr,
                    args.pag,
                    instInitPayloadSummaryCache,
                    pushRouterKey,
                    invokeMethodName
                );
                const routeKeys = payload.routeLiteralKeys;
                if (routeKeys.length > 0) {
                    let routeSet = routeKeysByRouterKey.get(pushRouterKey);
                    if (!routeSet) {
                        routeSet = new Set<string>();
                        routeKeysByRouterKey.set(pushRouterKey, routeSet);
                    }
                    for (const routeKey of routeKeys) {
                        routeSet.add(routeKey);
                    }
                }
                for (const nodeId of payload.payloadNodeIds) {
                    addMapSetValue(pushArgNodeIdsByRouterKey, pushRouterKey, nodeId);
                    addMapSetValue(pushArgNodeIdToRouterKeys, nodeId, pushRouterKey);
                    for (const routeKey of routeKeys) {
                        addMapSetValue(pushArgNodeIdsByRouterKey, routeKey, nodeId);
                        addMapSetValue(pushArgNodeIdToRouterKeys, nodeId, routeKey);
                    }
                    if (routeKeys.length === 0) {
                        ungroupedPushNodeIds.add(nodeId);
                    }
                }
                for (const endpoint of payload.payloadFieldEndpoints) {
                    const endpointKey = `${endpoint.objectNodeId}#${endpoint.fieldName}`;
                    addMapSetValue(pushFieldEndpointToRouterKeys, endpointKey, pushRouterKey);
                    for (const routeKey of routeKeys) {
                        addMapSetValue(pushFieldEndpointToRouterKeys, endpointKey, routeKey);
                    }
                    if (routeKeys.length === 0) {
                        ungroupedPushFieldEndpoints.add(endpointKey);
                    }
                }
                for (const target of payload.payloadValueFieldTargets) {
                    const existing = pushValueFieldTargetsByNodeId.get(target.nodeId) || [];
                    existing.push({
                        fieldName: target.fieldName,
                        routerKey: pushRouterKey,
                        ungrouped: routeKeys.length === 0,
                        passthrough: target.passthrough,
                    });
                    for (const routeKey of routeKeys) {
                        existing.push({
                            fieldName: target.fieldName,
                            routerKey: routeKey,
                            ungrouped: routeKeys.length === 0,
                            passthrough: target.passthrough,
                        });
                    }
                    pushValueFieldTargetsByNodeId.set(target.nodeId, dedupeRouterValueFieldTargets(existing));
                }
                continue;
            }

            const getRouterKey = resolveRouterGetIntent(
                invokeMethodSig,
                invokeMethodName,
                routerClassProfiles,
                suspiciousLogs,
                args.log
            );
            if (getRouterKey) {
                getCallCount++;
                if (!(stmt instanceof ArkAssignStmt)) continue;
                const leftOp = stmt.getLeftOp();
                const nodes = args.pag.getNodesByValue(leftOp);
                if (!nodes || nodes.size === 0) continue;
                for (const nodeId of nodes.values()) {
                    addMapSetValue(getResultNodeIdsByRouterKey, getRouterKey, nodeId);
                    const node = args.pag.getNode(nodeId) as PagNode | undefined;
                    const pointTo = node?.getPointTo?.();
                    if (pointTo) {
                        for (const objId of pointTo) {
                            addMapSetValue(getResultObjectNodeIdsByRouterKey, getRouterKey, objId);
                        }
                    }
                }
                continue;
            }

            const navDestinationClassName = invokeMethodSig.getDeclaringClassSignature?.()?.getClassName?.() || "";
            if (
                KNOWN_NAV_DESTINATION_CLASS_NAMES.has(navDestinationClassName)
                && KNOWN_NAV_DESTINATION_REGISTER_METHODS.has(invokeMethodName)
            ) {
                const navRouteKeys = collectNavDestinationRouteKeys(args.scene, method, invokeExpr);
                if (navRouteKeys.length === 0) continue;
                const callbackParamNodeIds = collectCallbackParamNodeIds(args.scene, args.pag, invokeExpr);
                if (callbackParamNodeIds.size === 0) continue;
                for (const routeKey of navRouteKeys) {
                    for (const nodeId of callbackParamNodeIds) {
                        addMapSetValue(getResultNodeIdsByRouterKey, routeKey, nodeId);
                    }
                }
                continue;
            }

            if (KNOWN_ROUTER_PUSH_METHODS.has(invokeMethodName) || KNOWN_ROUTER_GET_METHODS.has(invokeMethodName)) {
                suspiciousCallCount++;
            }
        }
    }

    return {
        pushArgNodeIdsByRouterKey,
        pushArgNodeIdToRouterKeys,
        pushFieldEndpointToRouterKeys,
        pushValueFieldTargetsByNodeId,
        getResultNodeIdsByRouterKey,
        getResultObjectNodeIdsByRouterKey,
        ungroupedPushNodeIds,
        ungroupedPushFieldEndpoints,
        pushCallCountByRouterKey,
        distinctRouteKeyCountByRouterKey: buildDistinctRouteKeyCountByRouterKey(routeKeysByRouterKey),
        pushCallCount,
        getCallCount,
        suspiciousCallCount,
    };
}

function resolveRouterPushIntent(
    methodSig: any,
    methodName: string,
    classProfiles: Map<string, RouterClassProfile>,
    suspiciousLogs: Set<string>,
    log?: (msg: string) => void
): string | undefined {
    if (!KNOWN_ROUTER_PUSH_METHODS.has(methodName)) return undefined;
    return resolveRouterIntent(methodSig, methodName, classProfiles, suspiciousLogs, log);
}

function resolveRouterGetIntent(
    methodSig: any,
    methodName: string,
    classProfiles: Map<string, RouterClassProfile>,
    suspiciousLogs: Set<string>,
    log?: (msg: string) => void
): string | undefined {
    if (!KNOWN_ROUTER_GET_METHODS.has(methodName)) return undefined;
    return resolveRouterIntent(methodSig, methodName, classProfiles, suspiciousLogs, log);
}

function resolveRouterIntent(
    methodSig: any,
    methodName: string,
    classProfiles: Map<string, RouterClassProfile>,
    suspiciousLogs: Set<string>,
    log?: (msg: string) => void
): string | undefined {
    const classKey = resolveClassKeyFromMethodSig(methodSig);
    const profile = classProfiles.get(classKey);
    if (!profile) return undefined;

    // Joint evidence: method semantics + (framework marker OR structural router-class evidence).
    const hasStructuralEvidence = profile.hasPush && profile.hasGet;
    if (profile.hasFrameworkMarker || hasStructuralEvidence) {
        return classKey;
    }

    const sigText = methodSig.toString?.() || "";
    const warnKey = `${classKey}#${methodName}`;
    if (!suspiciousLogs.has(warnKey)) {
        suspiciousLogs.add(warnKey);
        log?.(`[Harmony-Router] skip suspicious router-like call: method=${methodName}, class=${profile.className || profile.classSigText}, sig=${sigText}`);
    }
    return undefined;
}

function buildRouterClassProfiles(scene: Scene): Map<string, RouterClassProfile> {
    const profiles = new Map<string, RouterClassProfile>();
    for (const method of scene.getMethods()) {
        if (method.getName() === "%dflt") continue;
        const methodSig = method.getSignature?.();
        if (!methodSig) continue;
        const classSigText = methodSig.getDeclaringClassSignature?.()?.toString?.() || "";
        const className = methodSig.getDeclaringClassSignature?.()?.getClassName?.() || "";
        const classKey = resolveClassKeyFromMethodSig(methodSig);
        const methodName = methodSig.getMethodSubSignature?.()?.getMethodName?.() || "";
        const signatureText = methodSig.toString?.() || "";
        const text = `${classSigText} ${className} ${signatureText}`.toLowerCase();
        const profile = profiles.get(classKey) || {
            classKey,
            classSigText,
            className,
            hasPush: false,
            hasGet: false,
            hasFrameworkMarker: false,
        };
        if (KNOWN_ROUTER_PUSH_METHODS.has(methodName)) profile.hasPush = true;
        if (KNOWN_ROUTER_GET_METHODS.has(methodName)) profile.hasGet = true;
        if (!profile.hasFrameworkMarker && FRAMEWORK_SIGNATURE_HINTS.some(h => text.includes(h))) {
            profile.hasFrameworkMarker = true;
        }
        profiles.set(classKey, profile);
    }
    return profiles;
}

function incrementCounter(map: Map<string, number>, key: string): void {
    map.set(key, (map.get(key) || 0) + 1);
}

function buildDistinctRouteKeyCountByRouterKey(
    routeKeysByRouterKey: Map<string, Set<string>>
): Map<string, number> {
    const out = new Map<string, number>();
    for (const [routerKey, routeKeys] of routeKeysByRouterKey.entries()) {
        out.set(routerKey, routeKeys.size);
    }
    return out;
}

interface PushPayloadResult {
    payloadNodeIds: Set<number>;
    payloadFieldEndpoints: Array<{ objectNodeId: number; fieldName: string }>;
    payloadValueFieldTargets: Array<{ nodeId: number; fieldName: string; passthrough?: boolean }>;
    routeLiteralKeys: string[];
}

interface InstInitPayloadSummary {
    payloadNodeIds: Set<number>;
    payloadFieldEndpoints: Array<{ objectNodeId: number; fieldName: string }>;
    payloadValueFieldTargets: Array<{ nodeId: number; fieldName: string; passthrough?: boolean }>;
    routeLiterals: string[];
}

function collectPushPayload(
    scene: Scene,
    method: any,
    invokeExpr: any,
    pag: Pag,
    instInitPayloadSummaryCache: Map<string, InstInitPayloadSummary>,
    routerKey: string,
    invokeMethodName: string
): PushPayloadResult {
    const out = new Set<number>();
    const payloadFieldEndpoints = new Map<string, { objectNodeId: number; fieldName: string }>();
    const payloadValueFieldTargets = new Map<string, { nodeId: number; fieldName: string; passthrough?: boolean }>();
    const routeLiteralKeys = new Set<string>();
    const cfg = method.getCfg?.();
    const stmts = cfg ? cfg.getStmts() : [];
    const argsList = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    const routeFieldName = resolveRouteFieldNameForPushMethod(invokeMethodName);
    const visitedLocals = new Set<string>();
    const payloadContainerFieldNames = new Set(["param", "params"]);

    const addNodesFromValue = (value: any): void => {
        const nodes = pag.getNodesByValue(value);
        if (!nodes || nodes.size === 0) return;
        for (const nodeId of nodes.values()) {
            out.add(nodeId);
        }
    };

    const addRouteLiteral = (literal: string): void => {
        const normalized = literal.trim();
        if (!normalized) return;
        routeLiteralKeys.add(`${routerKey}::${routeFieldName}=${normalized}`);
        routeLiteralKeys.add(`${routeFieldName}=${normalized}`);
        routeLiteralKeys.add(`route=${normalized}`);
    };

    const addFieldEndpointFromBaseValue = (baseValue: any, fieldName: string): void => {
        const baseNodes = pag.getNodesByValue(baseValue);
        if (!baseNodes || baseNodes.size === 0) return;
        for (const nodeId of baseNodes.values()) {
            const node = pag.getNode(nodeId) as PagNode | undefined;
            const pointTo = node?.getPointTo?.();
            if (!pointTo) continue;
            for (const objectNodeId of pointTo) {
                payloadFieldEndpoints.set(
                    `${objectNodeId}#${fieldName}`,
                    { objectNodeId, fieldName },
                );
            }
        }
    };

    const addValueFieldTarget = (value: any, fieldName: string, passthrough = false): void => {
        if (!fieldName) return;
        const nodes = pag.getNodesByValue(value);
        if (!nodes || nodes.size === 0) return;
        for (const nodeId of nodes.values()) {
            payloadValueFieldTargets.set(
                `${nodeId}#${fieldName}#${passthrough ? "pass" : "prefix"}`,
                { nodeId, fieldName, passthrough },
            );
        }
    };

    const mergeInstInitPayloadSummary = (summary: InstInitPayloadSummary): void => {
        for (const nodeId of summary.payloadNodeIds) {
            out.add(nodeId);
        }
        for (const endpoint of summary.payloadFieldEndpoints) {
            payloadFieldEndpoints.set(`${endpoint.objectNodeId}#${endpoint.fieldName}`, endpoint);
        }
        for (const target of summary.payloadValueFieldTargets) {
            payloadValueFieldTargets.set(
                `${target.nodeId}#${target.fieldName}#${target.passthrough ? "pass" : "prefix"}`,
                target,
            );
        }
        for (const literal of summary.routeLiterals) {
            addRouteLiteral(literal);
        }
    };

    const localHasFieldAssignments = (local: Local): boolean => {
        for (const stmt of stmts) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            if (!(left instanceof ArkInstanceFieldRef)) continue;
            if (left.getBase() === local) {
                return true;
            }
        }
        return false;
    };

    const collectPayloadFromLocal = (local: Local, depth: number, payloadRoot: boolean): void => {
        if (depth > 3) return;
        const visitKey = `${local.getName()}|${String(local.getType?.()?.toString?.() || "")}`;
        if (visitedLocals.has(visitKey)) return;
        visitedLocals.add(visitKey);

        for (const stmt of stmts) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            if (!(left instanceof ArkInstanceFieldRef)) continue;
            if (left.getBase() !== local) continue;
            const right = stmt.getRightOp();
            addNodesFromValue(right);
            const fieldName = left.getFieldSignature?.().getFieldName?.() || "";
            if (payloadRoot && fieldName) {
                addFieldEndpointFromBaseValue(local, fieldName);
            }
            if (routeFieldName && fieldName === routeFieldName) {
                for (const literal of collectFiniteStringCandidatesFromValue(scene, right)) {
                    addRouteLiteral(literal);
                }
            }
            if (payloadRoot) {
                if (payloadContainerFieldNames.has(fieldName) && right instanceof Local) {
                    addValueFieldTarget(right, fieldName, true);
                    collectPayloadFromLocal(right, depth + 1, true);
                } else if (right instanceof Local && localHasFieldAssignments(right)) {
                    collectPayloadFromLocal(right, depth + 1, true);
                } else {
                    addValueFieldTarget(right, fieldName);
                }
                continue;
            }
            if (payloadContainerFieldNames.has(fieldName) && right instanceof Local) {
                addValueFieldTarget(right, fieldName, true);
                collectPayloadFromLocal(right, depth + 1, true);
            }
        }

        const classType = String(local.getType?.()?.toString?.() || "").trim();
        if (!classType) return;
        const cacheKey = `${classType}|${payloadRoot ? "root" : "wrapper"}|${routeFieldName || ""}`;
        let summary = instInitPayloadSummaryCache.get(cacheKey);
        if (!summary) {
            summary = collectInstInitPayloadSummary(
                scene,
                pag,
                classType,
                routeFieldName,
                payloadContainerFieldNames,
                payloadRoot,
                new Set<string>(),
            );
            instInitPayloadSummaryCache.set(cacheKey, summary);
        }
        mergeInstInitPayloadSummary(summary);
    };

    for (const arg of argsList) {
        addNodesFromValue(arg);
        if (!(arg instanceof Local)) continue;
        collectPayloadFromLocal(arg, 0, false);
    }

    return {
        payloadNodeIds: out,
        payloadFieldEndpoints: [...payloadFieldEndpoints.values()],
        payloadValueFieldTargets: [...payloadValueFieldTargets.values()],
        routeLiteralKeys: [...routeLiteralKeys],
    };
}

function dedupeRouterValueFieldTargets(
    targets: RouterValueFieldTarget[]
): RouterValueFieldTarget[] {
    const out = new Map<string, RouterValueFieldTarget>();
    for (const target of targets) {
        out.set(`${target.fieldName}|${target.routerKey}|${target.passthrough ? "pass" : "prefix"}`, target);
    }
    return [...out.values()];
}

function collectCallbackParamNodeIds(scene: Scene, pag: Pag, invokeExpr: any): Set<number> {
    const out = new Set<number>();
    const invokeArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    for (const arg of invokeArgs) {
        const callbackMethods = resolveCallbackMethodsFromArg(scene, arg);
        if (callbackMethods.length === 0) continue;
        for (const callbackMethod of callbackMethods) {
            const paramStmts = collectParameterAssignStmts(callbackMethod)
                .filter(s => (s.getRightOp() as ArkParameterRef).getIndex() === 0);
            if (paramStmts.length === 0) {
                const cfg = callbackMethod.getCfg?.();
                const stmts = cfg ? cfg.getStmts() : [];
                for (const stmt of stmts) {
                    if (!(stmt instanceof ArkAssignStmt)) continue;
                    const right = stmt.getRightOp();
                    if (!(right instanceof ArkParameterRef) || right.getIndex() !== 0) continue;
                    const left = stmt.getLeftOp();
                    const nodes = getOrCreatePagNodes(pag, left, stmt);
                    if (!nodes || nodes.size === 0) continue;
                    for (const nodeId of nodes.values()) {
                        out.add(nodeId);
                    }
                }
                continue;
            }
            for (const paramStmt of paramStmts) {
                const left = paramStmt.getLeftOp();
                const nodes = getOrCreatePagNodes(pag, left, paramStmt);
                if (!nodes || nodes.size === 0) continue;
                for (const nodeId of nodes.values()) {
                    out.add(nodeId);
                }
            }
        }
    }
    return out;
}

function resolveCallbackMethodsFromArg(scene: Scene, arg: any): any[] {
    const initial = resolveMethodsFromCallable(scene, arg, { maxCandidates: 8 });
    if (initial.length > 0) return initial;

    const bySig = new Set<any>();
    const rawName = String(arg?.getName?.() || arg?.toString?.() || "").trim();
    if (rawName.startsWith("%AM")) {
        for (const method of scene.getMethods()) {
            if (method.getName?.() === rawName && method.getCfg?.()) {
                bySig.add(method);
            }
        }
    }

    const methodSigText = arg?.getType?.()?.getMethodSignature?.()?.toString?.() || "";
    if (methodSigText) {
        const matched = scene.getMethods().find(m => m.getSignature?.().toString?.() === methodSigText);
        if (matched && matched.getCfg?.()) {
            bySig.add(matched);
        }
    }

    for (const hint of collectCallableNameHints(rawName, methodSigText)) {
        for (const method of scene.getMethods()) {
            if (method.getName?.() === hint && method.getCfg?.()) {
                bySig.add(method);
            }
        }
    }

    return [...bySig];
}

function collectCallableNameHints(...texts: string[]): string[] {
    const out = new Set<string>();
    const add = (name: string): void => {
        const normalized = String(name || "").trim().replace(/^['"`]|['"`]$/g, "");
        if (!normalized) return;
        if (normalized.includes("(")) return;
        out.add(normalized);
        if (normalized.includes(".")) {
            const tail = normalized.split(".").pop() || "";
            if (tail) out.add(tail);
        }
    };

    for (const text of texts) {
        const raw = String(text || "").trim();
        if (!raw) continue;
        add(raw);

        const callableToken = raw.match(/([A-Za-z_$%][A-Za-z0-9_$%]*)\s*(?:\(|$)/);
        if (callableToken?.[1]) {
            add(callableToken[1]);
        }

        const signatureName = raw.match(/\.([A-Za-z_$%][A-Za-z0-9_$%]*)\s*\(/);
        if (signatureName?.[1]) {
            add(signatureName[1]);
        }
    }

    return [...out];
}

function getOrCreatePagNodes(pag: Pag, value: any, anchorStmt: ArkAssignStmt): Map<number, number> | undefined {
    let nodes = pag.getNodesByValue(value);
    if (nodes && nodes.size > 0) {
        return nodes;
    }
    // Intentional side effect:
    // Some callback parameter locals are not materialized in PAG by base PTA.
    // We add a missing node anchored to the current stmt to preserve router callback bridge completeness.
    // This operation is idempotent (add-if-absent), so it is safe with PAG cache reuse.
    pag.addPagNode(0, value, anchorStmt);
    nodes = pag.getNodesByValue(value);
    return nodes;
}

function collectNavDestinationRouteKeys(scene: Scene, method: any, invokeExpr: any): string[] {
    const keys = new Set<string>();
    const cfg = method.getCfg?.();
    const stmts = cfg ? cfg.getStmts() : [];
    const invokeArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];

    const addLiteral = (literal: string): void => {
        const normalized = literal.trim();
        if (!normalized) return;
        keys.add(`name=${normalized}`);
        keys.add(`route=${normalized}`);
    };

    for (const arg of invokeArgs) {
        const literals = collectFiniteStringCandidatesFromValue(scene, arg);
        if (literals.length > 0) {
            for (const literal of literals) {
                addLiteral(literal);
            }
            continue;
        }
        if (!(arg instanceof Local)) continue;
        for (const stmt of stmts) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            if (!(left instanceof ArkInstanceFieldRef)) continue;
            if (left.getBase() !== arg) continue;
            const fieldName = left.getFieldSignature?.().getFieldName?.() || "";
            if (fieldName !== "name" && fieldName !== "url") continue;
            for (const fieldLiteral of collectFiniteStringCandidatesFromValue(scene, stmt.getRightOp())) {
                addLiteral(fieldLiteral);
            }
        }
    }

    return [...keys];
}

function collectInstInitPayloadSummary(
    scene: Scene,
    pag: Pag,
    classType: string,
    routeFieldName: string | undefined,
    payloadContainerFieldNames: Set<string>,
    payloadRoot: boolean,
    visiting: Set<string>,
): InstInitPayloadSummary {
    const out: InstInitPayloadSummary = {
        payloadNodeIds: new Set<number>(),
        payloadFieldEndpoints: [],
        payloadValueFieldTargets: [],
        routeLiterals: [],
    };
    const fieldEndpoints = new Map<string, { objectNodeId: number; fieldName: string }>();
    const valueTargets = new Map<string, { nodeId: number; fieldName: string; passthrough?: boolean }>();
    const routeLiterals = new Set<string>();
    const escapedClassType = escapeForRegex(classType);
    const instInitPattern = new RegExp(`${escapedClassType}\\.\\%instInit\\(`);
    const visitKey = `${classType}|${payloadRoot ? "root" : "wrapper"}|${routeFieldName || ""}`;
    if (visiting.has(visitKey)) {
        return out;
    }
    visiting.add(visitKey);

    const addFieldEndpointFromBaseValue = (baseValue: any, fieldName: string): void => {
        const baseNodes = pag.getNodesByValue(baseValue);
        if (!baseNodes || baseNodes.size === 0) return;
        for (const nodeId of baseNodes.values()) {
            const node = pag.getNode(nodeId) as PagNode | undefined;
            const pointTo = node?.getPointTo?.();
            if (!pointTo) continue;
            for (const objectNodeId of pointTo) {
                fieldEndpoints.set(`${objectNodeId}#${fieldName}`, { objectNodeId, fieldName });
            }
        }
    };

    const addValueFieldTarget = (value: any, fieldName: string, passthrough = false): void => {
        if (!fieldName) return;
        const nodes = pag.getNodesByValue(value);
        if (!nodes || nodes.size === 0) return;
        for (const nodeId of nodes.values()) {
            valueTargets.set(
                `${nodeId}#${fieldName}#${passthrough ? "pass" : "prefix"}`,
                { nodeId, fieldName, passthrough },
            );
        }
    };

    for (const method of scene.getMethods()) {
        if (method.getName() !== "%instInit") continue;
        const methodSig = method.getSignature?.().toString?.() || "";
        if (!instInitPattern.test(methodSig)) continue;
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            if (!(left instanceof ArkInstanceFieldRef)) continue;
            const base = left.getBase();
            if (!(base instanceof Local) || base.getName() !== "this") continue;
            const currentField = left.getFieldSignature?.().getFieldName?.() || "";
            const right = stmt.getRightOp();
            const rightNodes = pag.getNodesByValue(right);
            if (rightNodes && rightNodes.size > 0) {
                for (const nodeId of rightNodes.values()) {
                    out.payloadNodeIds.add(nodeId);
                }
            }
            if (payloadRoot && currentField) {
                addFieldEndpointFromBaseValue(base, currentField);
            }
            if (routeFieldName && currentField === routeFieldName) {
                for (const literal of collectFiniteStringCandidatesFromValue(scene, right)) {
                    routeLiterals.add(literal);
                }
            }
            if (payloadContainerFieldNames.has(currentField) && right instanceof Local) {
                addValueFieldTarget(right, currentField, true);
                const nestedType = String(right.getType?.()?.toString?.() || "").trim();
                if (nestedType) {
                    const nested = collectInstInitPayloadSummary(
                        scene,
                        pag,
                        nestedType,
                        routeFieldName,
                        payloadContainerFieldNames,
                        true,
                        visiting,
                    );
                    for (const nodeId of nested.payloadNodeIds) {
                        out.payloadNodeIds.add(nodeId);
                    }
                    for (const endpoint of nested.payloadFieldEndpoints) {
                        fieldEndpoints.set(`${endpoint.objectNodeId}#${endpoint.fieldName}`, endpoint);
                    }
                    for (const target of nested.payloadValueFieldTargets) {
                        valueTargets.set(
                            `${target.nodeId}#${target.fieldName}#${target.passthrough ? "pass" : "prefix"}`,
                            target,
                        );
                    }
                    for (const literal of nested.routeLiterals) {
                        routeLiterals.add(literal);
                    }
                }
                continue;
            }
            if (payloadRoot && currentField) {
                addValueFieldTarget(right, currentField);
            }
        }
    }

    visiting.delete(visitKey);
    out.payloadFieldEndpoints = [...fieldEndpoints.values()];
    out.payloadValueFieldTargets = [...valueTargets.values()];
    out.routeLiterals = [...routeLiterals];
    return out;
}

function resolveRouteFieldNameForPushMethod(methodName: string): string | undefined {
    if (methodName === "pushNamedRoute") return "name";
    if (methodName === "pushPath" || methodName === "pushPathByName" || methodName === "replacePath") return "name";
    if (methodName === "pushUrl" || methodName === "replaceUrl") return "url";
    return undefined;
}

function tryParseStringLiteral(value: any): string | undefined {
    const text = String(value?.toString?.() || "").trim();
    const m = text.match(/^(['"`])((?:\\.|(?!\1).)*)\1$/);
    if (!m) return undefined;
    return m[2];
}

function escapeForRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
