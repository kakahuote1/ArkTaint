import { Scene } from "../../../../../arkanalyzer/out/src/Scene";
import { Pag, PagNode } from "../../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../../../arkanalyzer/out/src/core/base/Expr";
import { ArkInstanceFieldRef } from "../../../../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../../../../arkanalyzer/out/src/core/base/Local";
import {
    defineModule,
    type TaintModule,
} from "../../../kernel/contracts/ModuleApi";
import type {
    BuildRouterSemanticModelArgs,
    RouterSemanticModel,
    RouterValueFieldTarget,
} from "../../../kernel/contracts/RouterModuleProvider";
import {
    addMapSetValue,
    collectObjectNodeIdsFromValue,
    resolveClassKeyFromMethodSig,
    resolveHarmonyMethods,
} from "../../../kernel/contracts/HarmonyModuleUtils";

export interface HarmonyRoutePushMethodOption {
    methodName: string;
    routeField?: string;
}

export interface HarmonyRouteBridgeSemanticsOptions {
    id?: string;
    description?: string;
    pushMethods?: HarmonyRoutePushMethodOption[];
    getMethods?: string[];
    navDestinationClassNames?: string[];
    navDestinationRegisterMethods?: string[];
    navDestinationTriggerMethods?: string[];
    frameworkSignatureHints?: string[];
    payloadUnwrapPrefixes?: string[];
}

const DEFAULT_ROUTER_OPTIONS: Required<HarmonyRouteBridgeSemanticsOptions> = {
    id: "harmony.router",
    description: "Built-in Harmony router/nav destination bridges.",
    pushMethods: [
        { methodName: "pushUrl", routeField: "url" },
        { methodName: "replaceUrl", routeField: "url" },
        { methodName: "pushNamedRoute", routeField: "name" },
        { methodName: "pushPath", routeField: "name" },
        { methodName: "pushPathByName", routeField: "name" },
        { methodName: "replacePath", routeField: "name" },
    ],
    getMethods: ["getParams"],
    navDestinationClassNames: ["NavDestination"],
    navDestinationRegisterMethods: ["register", "setBuilder", "setDestinationBuilder"],
    navDestinationTriggerMethods: ["trigger"],
    frameworkSignatureHints: ["@ohos", "@ohossdk", "ohos.router", "ohos/router"],
    payloadUnwrapPrefixes: ["param", "params"],
};

const NAV_DESTINATION_FALLBACK_KEY = "__nav_destination_fallback__";

interface BuildRouterInternalOptions {
    pushMethodNames: Set<string>;
    getMethodNames: Set<string>;
    navDestinationClassNames: Set<string>;
    navDestinationRegisterMethods: Set<string>;
    navDestinationTriggerMethods: Set<string>;
    frameworkSignatureHints: string[];
    payloadUnwrapPrefixes: string[];
    routeFieldByPushMethod: Map<string, string>;
}

export function createHarmonyRouteBridgeSemanticModule(
    options: HarmonyRouteBridgeSemanticsOptions = {},
): TaintModule {
    const resolved = {
        ...DEFAULT_ROUTER_OPTIONS,
        ...options,
        pushMethods: options.pushMethods && options.pushMethods.length > 0
            ? options.pushMethods.map(item => ({ ...item }))
            : DEFAULT_ROUTER_OPTIONS.pushMethods.map(item => ({ ...item })),
        getMethods: options.getMethods && options.getMethods.length > 0
            ? [...options.getMethods]
            : [...DEFAULT_ROUTER_OPTIONS.getMethods],
        navDestinationClassNames: options.navDestinationClassNames && options.navDestinationClassNames.length > 0
            ? [...options.navDestinationClassNames]
            : [...DEFAULT_ROUTER_OPTIONS.navDestinationClassNames],
        navDestinationRegisterMethods: options.navDestinationRegisterMethods && options.navDestinationRegisterMethods.length > 0
            ? [...options.navDestinationRegisterMethods]
            : [...DEFAULT_ROUTER_OPTIONS.navDestinationRegisterMethods],
        navDestinationTriggerMethods: options.navDestinationTriggerMethods && options.navDestinationTriggerMethods.length > 0
            ? [...options.navDestinationTriggerMethods]
            : [...DEFAULT_ROUTER_OPTIONS.navDestinationTriggerMethods],
        frameworkSignatureHints: options.frameworkSignatureHints && options.frameworkSignatureHints.length > 0
            ? [...options.frameworkSignatureHints]
            : [...DEFAULT_ROUTER_OPTIONS.frameworkSignatureHints],
        payloadUnwrapPrefixes: options.payloadUnwrapPrefixes && options.payloadUnwrapPrefixes.length > 0
            ? [...options.payloadUnwrapPrefixes]
            : [...DEFAULT_ROUTER_OPTIONS.payloadUnwrapPrefixes],
    };
    const internalOptions: BuildRouterInternalOptions = {
        pushMethodNames: new Set(resolved.pushMethods.map(item => item.methodName)),
        getMethodNames: new Set(resolved.getMethods),
        navDestinationClassNames: new Set(resolved.navDestinationClassNames),
        navDestinationRegisterMethods: new Set(resolved.navDestinationRegisterMethods),
        navDestinationTriggerMethods: new Set(resolved.navDestinationTriggerMethods),
        frameworkSignatureHints: [...resolved.frameworkSignatureHints],
        payloadUnwrapPrefixes: [...resolved.payloadUnwrapPrefixes],
        routeFieldByPushMethod: new Map(
            resolved.pushMethods
                .filter(item => item.routeField)
                .map(item => [item.methodName, item.routeField as string]),
        ),
    };

    return defineModule({
        id: resolved.id,
        description: resolved.description,
        setup(ctx) {
            const model = buildRouterModel({
                scene: ctx.raw.scene,
                pag: ctx.raw.pag,
                allowedMethodSignatures: ctx.raw.allowedMethodSignatures,
                analysis: ctx.analysis,
                callbacks: ctx.callbacks,
                log: ctx.log,
            }, internalOptions);
        const navCallbackMethodsByRouteKey = collectNavDestinationCallbackMethods(ctx, internalOptions, resolved);
        const navTriggerSitesByRouteKey = collectNavDestinationTriggerSites(ctx, internalOptions, resolved);
        let navDeferredBindingCount = 0;
        for (const [routeKey, triggerSites] of navTriggerSitesByRouteKey.entries()) {
            const callbackMethods = navCallbackMethodsByRouteKey.get(routeKey);
            if (!callbackMethods || callbackMethods.size === 0) continue;
            for (const triggerSite of triggerSites) {
                for (const handlerMethod of callbackMethods.values()) {
                    ctx.deferred.declarative({
                        sourceMethod: triggerSite.sourceMethod,
                        handlerMethod,
                        anchorStmt: triggerSite.anchorStmt,
                        triggerLabel: routeKey,
                        activationSource: { kind: "arg", index: 0 },
                        payloadSource: { kind: "arg", index: 0 },
                        reason: `Harmony router nav-destination dispatch ${routeKey}`,
                    });
                    navDeferredBindingCount++;
                }
            }
        }
        const routerBridgeCount = Array.from(model.getResultNodeIdsByRouterKey.values())
            .reduce((acc, ids) => acc + (ids as Set<number>).size, 0);
        ctx.debug.summary("Harmony-Router", {
            push_calls: model.pushCallCount,
            get_calls: model.getCallCount,
            bridged_nodes: routerBridgeCount,
            suspicious_calls: model.suspiciousCallCount,
            ungrouped_push_nodes: model.ungroupedPushNodeIds.size,
            nav_deferred_bindings: navDeferredBindingCount,
        });

        const loggedRouterConservativeSkips = new Set<string>();

        return {
            onFact(event) {
                const emissions = event.emit.collector();

                const fieldHead = event.current.fieldHead();
                const currentField = event.current.cloneField();
                const resultField = unwrapRouterPayloadField(currentField, internalOptions.payloadUnwrapPrefixes);
                const routerKeys = new Set<string>(model.pushArgNodeIdToRouterKeys.get(event.current.nodeId) || []);
                const endpointKey = fieldHead
                    ? `${event.current.nodeId}#${fieldHead}`
                    : undefined;
                if (endpointKey) {
                    for (const routerKey of model.pushFieldEndpointToRouterKeys.get(endpointKey) || []) {
                        routerKeys.add(routerKey);
                    }
                }

                const valueFieldTargets = model.pushValueFieldTargetsByNodeId.get(event.current.nodeId) || [];
                for (const target of valueFieldTargets) {
                    const resultObjectIds = model.getResultObjectNodeIdsByRouterKey.get(target.routerKey);
                    const fieldPath = target.passthrough
                        ? currentField
                        : (currentField && currentField.length > 0
                            ? [target.fieldName, ...currentField]
                            : [target.fieldName]);
                    const normalizedFieldPath = unwrapRouterPayloadField(fieldPath, internalOptions.payloadUnwrapPrefixes);
                    const emissionField = normalizedFieldPath && normalizedFieldPath.length > 0
                        ? normalizedFieldPath
                        : [];
                    if (!resultObjectIds || resultObjectIds.size === 0) {
                        const targetNodeIds = model.getResultNodeIdsByRouterKey.get(target.routerKey);
                        if (!targetNodeIds || targetNodeIds.size === 0) continue;
                        emissions.push(
                            emissionField.length > 0
                                ? event.emit.toFields(
                                    targetNodeIds,
                                    emissionField,
                                    "Harmony-RouterField",
                                    { allowUnreachableTarget: true },
                                )
                                : event.emit.toNodes(
                                    targetNodeIds,
                                    "Harmony-RouterField",
                                    { allowUnreachableTarget: true },
                                ),
                        );
                        continue;
                    }
                    for (const objectNodeId of resultObjectIds) {
                        if (!normalizedFieldPath || normalizedFieldPath.length === 0) {
                            emissions.push(event.emit.toNode(objectNodeId, "Harmony-RouterField"));
                            continue;
                        }
                        emissions.push(event.emit.toField(objectNodeId, normalizedFieldPath, "Harmony-RouterField"));
                    }
                }

                for (const routerKey of routerKeys) {
                    const triggerSites = navTriggerSitesByRouteKey.get(routerKey);
                    if (triggerSites && triggerSites.length > 0) {
                        const triggerArgNodeIds = new Set<number>();
                        for (const triggerSite of triggerSites) {
                            for (const nodeId of triggerSite.argNodeIds) {
                                triggerArgNodeIds.add(nodeId);
                            }
                        }
                        if (triggerArgNodeIds.size > 0) {
                            emissions.push(event.emit.toNodes(
                                triggerArgNodeIds,
                                "Harmony-RouterTrigger",
                                { allowUnreachableTarget: true },
                            ));
                        }
                    }
                    const targetNodeIds = model.getResultNodeIdsByRouterKey.get(routerKey);
                    if (targetNodeIds && targetNodeIds.size > 0) {
                        const isUngroupedPush = model.ungroupedPushNodeIds.has(event.current.nodeId)
                            || (!!endpointKey && model.ungroupedPushFieldEndpoints.has(endpointKey));
                        if (isUngroupedPush) {
                            const pushCount = model.pushCallCountByRouterKey.get(routerKey) || 0;
                            const routeCount = model.distinctRouteKeyCountByRouterKey.get(routerKey) || 0;
                            const hasAmbiguousTargets = targetNodeIds.size > 1;
                            const hasAmbiguousRoutes = routeCount === 0 || routeCount > 1;
                            if (pushCount > 1 && hasAmbiguousTargets && hasAmbiguousRoutes) {
                                const skipKey = `${routerKey}:${event.current.nodeId}:${endpointKey || "-"}`;
                                if (!loggedRouterConservativeSkips.has(skipKey)) {
                                    loggedRouterConservativeSkips.add(skipKey);
                                    event.debug.skip(
                                        `[Harmony-Router] conservative skip for ungrouped push node=${event.current.nodeId} `
                                        + `(router=${routerKey}, pushCount=${pushCount}, routeCount=${routeCount})`,
                                    );
                                }
                                continue;
                            }
                        }

                        if (currentField && currentField.length > 0) {
                            emissions.push(
                                resultField && resultField.length > 0
                                    ? event.emit.toFields(targetNodeIds, resultField, "Harmony-RouterBridge")
                                    : event.emit.toNodes(targetNodeIds, "Harmony-RouterBridge"),
                            );
                        } else {
                            emissions.push(event.emit.toNodes(targetNodeIds, "Harmony-RouterBridge"));
                        }
                    }

                    if (endpointKey) {
                        const resultObjectIds = model.getResultObjectNodeIdsByRouterKey.get(routerKey);
                        if (!resultObjectIds || resultObjectIds.size === 0) continue;
                        for (const objectNodeId of resultObjectIds) {
                            if (!resultField || resultField.length === 0) {
                                emissions.push(event.emit.toNode(objectNodeId, "Harmony-RouterField"));
                                continue;
                            }
                            emissions.push(event.emit.toField(objectNodeId, resultField, "Harmony-RouterField"));
                        }
                    }
                }

                return emissions.done();
            },
        };
        },
    });
}

export const harmonyRouterSemanticModule = createHarmonyRouteBridgeSemanticModule();
export const harmonyRouterModule: TaintModule = harmonyRouterSemanticModule;

type RouterModel = RouterSemanticModel;
type BuildRouterModelArgs = BuildRouterSemanticModelArgs;

function unwrapRouterPayloadField(fieldPath?: string[], unwrapPrefixes: string[] = DEFAULT_ROUTER_OPTIONS.payloadUnwrapPrefixes): string[] | undefined {
    if (!fieldPath || fieldPath.length === 0) {
        return undefined;
    }
    const [head, ...tail] = fieldPath;
    if (unwrapPrefixes.includes(head)) {
        return tail.length > 0 ? tail : undefined;
    }
    return fieldPath;
}

interface RouterClassProfile {
    classKey: string;
    classSigText: string;
    className: string;
    hasPush: boolean;
    hasGet: boolean;
    hasFrameworkMarker: boolean;
}

export function buildRouterModel(
    args: BuildRouterModelArgs,
    options: BuildRouterInternalOptions = {
        pushMethodNames: new Set(DEFAULT_ROUTER_OPTIONS.pushMethods.map(item => item.methodName)),
        getMethodNames: new Set(DEFAULT_ROUTER_OPTIONS.getMethods),
        navDestinationClassNames: new Set(DEFAULT_ROUTER_OPTIONS.navDestinationClassNames),
        navDestinationRegisterMethods: new Set(DEFAULT_ROUTER_OPTIONS.navDestinationRegisterMethods),
        navDestinationTriggerMethods: new Set(DEFAULT_ROUTER_OPTIONS.navDestinationTriggerMethods),
        frameworkSignatureHints: [...DEFAULT_ROUTER_OPTIONS.frameworkSignatureHints],
        payloadUnwrapPrefixes: [...DEFAULT_ROUTER_OPTIONS.payloadUnwrapPrefixes],
        routeFieldByPushMethod: new Map(
            DEFAULT_ROUTER_OPTIONS.pushMethods
                .filter(item => item.routeField)
                .map(item => [item.methodName, item.routeField as string]),
        ),
    },
): RouterModel {
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
    const routerClassProfiles = buildRouterClassProfiles(args.scene, options);
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
                options,
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
                    args.analysis,
                    instInitPayloadSummaryCache,
                    pushRouterKey,
                    invokeMethodName,
                    options,
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
                    addMapSetValue(pushArgNodeIdsByRouterKey, NAV_DESTINATION_FALLBACK_KEY, nodeId);
                    addMapSetValue(pushArgNodeIdToRouterKeys, nodeId, NAV_DESTINATION_FALLBACK_KEY);
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
                    addMapSetValue(pushFieldEndpointToRouterKeys, endpointKey, NAV_DESTINATION_FALLBACK_KEY);
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
                    existing.push({
                        fieldName: target.fieldName,
                        routerKey: NAV_DESTINATION_FALLBACK_KEY,
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
                options,
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
                options.navDestinationClassNames.has(navDestinationClassName)
                && options.navDestinationRegisterMethods.has(invokeMethodName)
            ) {
                const navRouteKeys = collectNavDestinationRouteKeys(args.analysis, method, invokeExpr);
                if (navRouteKeys.length === 0) continue;
                const callbackParamNodeIds = collectCallbackParamNodeIds(args.callbacks, invokeExpr);
                if (callbackParamNodeIds.size === 0) continue;
                for (const routeKey of navRouteKeys) {
                    for (const nodeId of callbackParamNodeIds) {
                        addMapSetValue(getResultNodeIdsByRouterKey, routeKey, nodeId);
                    }
                }
                continue;
            }

            if (options.pushMethodNames.has(invokeMethodName) || options.getMethodNames.has(invokeMethodName)) {
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
    options: BuildRouterInternalOptions,
    suspiciousLogs: Set<string>,
    log?: (msg: string) => void
): string | undefined {
    if (!options.pushMethodNames.has(methodName)) return undefined;
    return resolveRouterIntent(methodSig, methodName, classProfiles, options, suspiciousLogs, log);
}

function resolveRouterGetIntent(
    methodSig: any,
    methodName: string,
    classProfiles: Map<string, RouterClassProfile>,
    options: BuildRouterInternalOptions,
    suspiciousLogs: Set<string>,
    log?: (msg: string) => void
): string | undefined {
    if (!options.getMethodNames.has(methodName)) return undefined;
    return resolveRouterIntent(methodSig, methodName, classProfiles, options, suspiciousLogs, log);
}

function resolveRouterIntent(
    methodSig: any,
    methodName: string,
    classProfiles: Map<string, RouterClassProfile>,
    options: BuildRouterInternalOptions,
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

function buildRouterClassProfiles(scene: Scene, options: BuildRouterInternalOptions = {
    pushMethodNames: new Set(DEFAULT_ROUTER_OPTIONS.pushMethods.map(item => item.methodName)),
    getMethodNames: new Set(DEFAULT_ROUTER_OPTIONS.getMethods),
    navDestinationClassNames: new Set(DEFAULT_ROUTER_OPTIONS.navDestinationClassNames),
    navDestinationRegisterMethods: new Set(DEFAULT_ROUTER_OPTIONS.navDestinationRegisterMethods),
    navDestinationTriggerMethods: new Set(DEFAULT_ROUTER_OPTIONS.navDestinationTriggerMethods),
    frameworkSignatureHints: [...DEFAULT_ROUTER_OPTIONS.frameworkSignatureHints],
    payloadUnwrapPrefixes: [...DEFAULT_ROUTER_OPTIONS.payloadUnwrapPrefixes],
    routeFieldByPushMethod: new Map(
        DEFAULT_ROUTER_OPTIONS.pushMethods
            .filter(item => item.routeField)
            .map(item => [item.methodName, item.routeField as string]),
    ),
}): Map<string, RouterClassProfile> {
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
        if (options.pushMethodNames.has(methodName)) profile.hasPush = true;
        if (options.getMethodNames.has(methodName)) profile.hasGet = true;
        if (!profile.hasFrameworkMarker && options.frameworkSignatureHints.some(h => text.includes(h))) {
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
    analysis: BuildRouterModelArgs["analysis"],
    instInitPayloadSummaryCache: Map<string, InstInitPayloadSummary>,
    routerKey: string,
    invokeMethodName: string,
    options: BuildRouterInternalOptions,
): PushPayloadResult {
    const out = new Set<number>();
    const payloadFieldEndpoints = new Map<string, { objectNodeId: number; fieldName: string }>();
    const payloadValueFieldTargets = new Map<string, { nodeId: number; fieldName: string; passthrough?: boolean }>();
    const routeLiteralKeys = new Set<string>();
    const cfg = method.getCfg?.();
    const stmts = cfg ? cfg.getStmts() : [];
    const argsList = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    const routeFieldName = resolveRouteFieldNameForPushMethod(invokeMethodName, options.routeFieldByPushMethod);
    const visitedLocals = new Set<string>();
    const payloadContainerFieldNames = new Set(["param", "params"]);

    const addNodesFromValue = (value: any): void => {
        const nodes = pag.getNodesByValue(value);
        if (!nodes || nodes.size === 0) return;
        for (const nodeId of nodes.values()) {
            out.add(nodeId);
        }
        for (const objectNodeId of collectObjectNodeIdsFromValue(pag, value)) {
            out.add(objectNodeId);
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
                for (const literal of analysis.stringCandidates(right)) {
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
                addFieldEndpointFromBaseValue(local, fieldName);
                addValueFieldTarget(right, fieldName, true);
                collectPayloadFromLocal(right, depth + 1, true);
            } else if (payloadContainerFieldNames.has(fieldName)) {
                addFieldEndpointFromBaseValue(local, fieldName);
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
                analysis,
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

function collectNavDestinationCallbackMethods(
    ctx: Parameters<NonNullable<TaintModule["setup"]>>[0],
    options: BuildRouterInternalOptions,
    resolved: Required<HarmonyRouteBridgeSemanticsOptions>,
): Map<string, Map<string, any>> {
    const out = new Map<string, Map<string, any>>();
    const minArgs = Math.max(1, 0);
    for (const call of ctx.scan.invokes({ minArgs })) {
        const declaringClassName = call.call.declaringClassName || "";
        if (!options.navDestinationClassNames.has(declaringClassName)) continue;
        if (!options.navDestinationRegisterMethods.has(call.call.methodName)) continue;
        const routeKeys = collectNavDestinationRouteKeys(ctx.analysis, call.stmt?.getCfg?.()?.getDeclaringMethod?.(), call.stmt?.getInvokeExpr?.());
        if (routeKeys.length === 0) continue;
        const callbackValue = call.arg(1);
        const callbackMethods = ctx.callbacks.methods(callbackValue, { maxCandidates: 8 });
        if (callbackMethods.length === 0) continue;
        for (const routeKey of routeKeys) {
            let bucket = out.get(routeKey);
            if (!bucket) {
                bucket = new Map<string, any>();
                out.set(routeKey, bucket);
            }
            for (const callbackMethod of callbackMethods) {
                bucket.set(callbackMethod.methodSignature, callbackMethod.method);
            }
        }
        if (routeKeys.length === 0) {
            let fallbackBucket = out.get(NAV_DESTINATION_FALLBACK_KEY);
            if (!fallbackBucket) {
                fallbackBucket = new Map<string, any>();
                out.set(NAV_DESTINATION_FALLBACK_KEY, fallbackBucket);
            }
            for (const callbackMethod of callbackMethods) {
                fallbackBucket.set(callbackMethod.methodSignature, callbackMethod.method);
            }
        }
    }
    return out;
}

function collectNavDestinationTriggerSites(
    ctx: Parameters<NonNullable<TaintModule["setup"]>>[0],
    options: BuildRouterInternalOptions,
    resolved: Required<HarmonyRouteBridgeSemanticsOptions>,
): Map<string, Array<{ sourceMethod: any; anchorStmt: any; argNodeIds: number[] }>> {
    const out = new Map<string, Array<{ sourceMethod: any; anchorStmt: any; argNodeIds: number[] }>>();
    for (const call of ctx.scan.invokes({ minArgs: 1 })) {
        const declaringClassName = call.call.declaringClassName || "";
        if (!options.navDestinationClassNames.has(declaringClassName)) continue;
        if (!options.navDestinationTriggerMethods.has(call.call.methodName)) continue;
        const sourceMethod = call.stmt?.getCfg?.()?.getDeclaringMethod?.();
        if (!sourceMethod?.getCfg?.()) continue;
        const routeKeys = collectNavDestinationRouteKeys(ctx.analysis, sourceMethod, call.stmt?.getInvokeExpr?.());
        if (routeKeys.length === 0) continue;
        const argNodeIds = call.argNodeIds(0);
        if (argNodeIds.length === 0) continue;
        for (const routeKey of routeKeys) {
            const bucket = out.get(routeKey) || [];
            bucket.push({
                sourceMethod,
                anchorStmt: call.stmt,
                argNodeIds: [...argNodeIds],
            });
            out.set(routeKey, bucket);
        }
        if (routeKeys.length === 0) {
            const fallbackBucket = out.get(NAV_DESTINATION_FALLBACK_KEY) || [];
            fallbackBucket.push({
                sourceMethod,
                anchorStmt: call.stmt,
                argNodeIds: [...argNodeIds],
            });
            out.set(NAV_DESTINATION_FALLBACK_KEY, fallbackBucket);
        }
    }
    return out;
}

function collectCallbackParamNodeIds(callbacks: BuildRouterModelArgs["callbacks"], invokeExpr: any): Set<number> {
    const out = new Set<number>();
    const invokeArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    for (const arg of invokeArgs) {
        for (const binding of callbacks.paramBindings(arg, 0, { maxCandidates: 8 })) {
            for (const nodeId of binding.localNodeIds()) {
                out.add(nodeId);
            }
        }
    }
    return out;
}

function collectNavDestinationRouteKeys(analysis: BuildRouterModelArgs["analysis"], method: any, invokeExpr: any): string[] {
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
        const literals = analysis.stringCandidates(arg);
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
            for (const fieldLiteral of analysis.stringCandidates(stmt.getRightOp())) {
                addLiteral(fieldLiteral);
            }
        }
    }

    return [...keys];
}

function collectInstInitPayloadSummary(
    scene: Scene,
    pag: Pag,
    analysis: BuildRouterModelArgs["analysis"],
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
                for (const literal of analysis.stringCandidates(right)) {
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
                        analysis,
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

function resolveRouteFieldNameForPushMethod(
    methodName: string,
    routeFieldByPushMethod: Map<string, string>,
): string | undefined {
    return routeFieldByPushMethod.get(methodName);
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

export default harmonyRouterModule;

