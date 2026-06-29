import { Scene } from "../../../../../arkanalyzer/out/src/Scene";
import { Pag, PagNode } from "../../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkCastExpr, ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../../../arkanalyzer/out/src/core/base/Expr";
import { ArkInstanceFieldRef } from "../../../../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../../../../arkanalyzer/out/src/core/base/Local";
import {
    defineModule,
    type ModuleAnalysisApi,
    type ModuleScannedInvoke,
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
    resolveHarmonyMethods,
} from "../../../kernel/contracts/HarmonyModuleUtils";
import { createHandoffPropagationSession } from "../../../kernel/semantic_handoff/SemanticHandoffPropagation";
import { createExactHandoffHandle, HandoffEffect } from "../../../kernel/semantic_handoff/SemanticHandoffTypes";
import { parseCanonicalApiId } from "../../../api/identity";
import { isConsumableSemanticEndpointProjection } from "../../../kernel/contracts/PagNodeResolution";

export interface HarmonyRoutePushApiOption {
    canonicalApiIds: string[];
    routeField?: string;
    routeArgIndex?: number;
    payloadArgIndex?: number;
    payloadField?: string;
}

export interface HarmonyRouteRegisterApiOption {
    canonicalApiIds: string[];
    callbackArgIndex: number;
    routeParamIndex?: number;
    payloadParamIndex: number;
}

export interface HarmonyRouteGetApiOption {
    canonicalApiIds: string[];
    routeArgIndex?: number;
    routeField?: string;
}

export interface HarmonyRouteBridgeSemanticsOptions {
    id?: string;
    description?: string;
    pushApis?: HarmonyRoutePushApiOption[];
    getCanonicalApiIds?: string[];
    getApis?: HarmonyRouteGetApiOption[];
    navDestinationRegisterApis?: HarmonyRouteRegisterApiOption[];
    navDestinationTriggerApis?: HarmonyRoutePushApiOption[];
    payloadUnwrapPrefixes?: string[];
}

const DEFAULT_ROUTER_OPTIONS: Required<HarmonyRouteBridgeSemanticsOptions> = {
    id: "harmony.router",
    description: "Built-in Harmony router/nav destination bridges.",
    pushApis: [],
    getCanonicalApiIds: [],
    getApis: [],
    navDestinationRegisterApis: [],
    navDestinationTriggerApis: [],
    payloadUnwrapPrefixes: [],
};

interface BuildRouterInternalOptions {
    pushCanonicalApiIds: Set<string>;
    getCanonicalApiIds: Set<string>;
    getApiByCanonicalApiId: Map<string, HarmonyRouteGetApiOption>;
    navDestinationRegisterCanonicalApiIds: Set<string>;
    navDestinationTriggerCanonicalApiIds: Set<string>;
    payloadUnwrapPrefixes: string[];
    routeFieldByPushCanonicalApiId: Map<string, string>;
    pushApiByCanonicalApiId: Map<string, HarmonyRoutePushApiOption>;
    navDestinationRegisterApiByCanonicalApiId: Map<string, HarmonyRouteRegisterApiOption>;
    navDestinationTriggerApiByCanonicalApiId: Map<string, HarmonyRoutePushApiOption>;
}

export function createHarmonyRouteBridgeSemanticModule(
    options: HarmonyRouteBridgeSemanticsOptions = {},
): TaintModule {
    const resolved = {
        ...DEFAULT_ROUTER_OPTIONS,
        ...options,
        pushApis: options.pushApis && options.pushApis.length > 0
            ? options.pushApis.map(item => ({
                canonicalApiIds: [...new Set(item.canonicalApiIds || [])].sort((left, right) => left.localeCompare(right)),
                routeField: item.routeField,
                routeArgIndex: item.routeArgIndex,
                payloadArgIndex: item.payloadArgIndex,
                payloadField: item.payloadField,
            }))
            : DEFAULT_ROUTER_OPTIONS.pushApis.map(item => ({
                canonicalApiIds: [...item.canonicalApiIds],
                routeField: item.routeField,
                routeArgIndex: item.routeArgIndex,
                payloadArgIndex: item.payloadArgIndex,
                payloadField: item.payloadField,
            })),
        getCanonicalApiIds: options.getCanonicalApiIds && options.getCanonicalApiIds.length > 0
            ? [...options.getCanonicalApiIds]
            : [...DEFAULT_ROUTER_OPTIONS.getCanonicalApiIds],
        getApis: options.getApis && options.getApis.length > 0
            ? options.getApis.map(item => ({
                canonicalApiIds: [...new Set(item.canonicalApiIds || [])].sort((left, right) => left.localeCompare(right)),
                routeArgIndex: item.routeArgIndex,
                routeField: item.routeField,
            }))
            : DEFAULT_ROUTER_OPTIONS.getApis.map(item => ({
                canonicalApiIds: [...item.canonicalApiIds],
                routeArgIndex: item.routeArgIndex,
                routeField: item.routeField,
            })),
        navDestinationRegisterApis: options.navDestinationRegisterApis && options.navDestinationRegisterApis.length > 0
            ? options.navDestinationRegisterApis.map(item => ({
                canonicalApiIds: [...new Set(item.canonicalApiIds || [])].sort((left, right) => left.localeCompare(right)),
                callbackArgIndex: item.callbackArgIndex,
                routeParamIndex: item.routeParamIndex,
                payloadParamIndex: item.payloadParamIndex,
            }))
            : DEFAULT_ROUTER_OPTIONS.navDestinationRegisterApis.map(item => ({
                canonicalApiIds: [...item.canonicalApiIds],
                callbackArgIndex: item.callbackArgIndex,
                routeParamIndex: item.routeParamIndex,
                payloadParamIndex: item.payloadParamIndex,
            })),
        navDestinationTriggerApis: options.navDestinationTriggerApis && options.navDestinationTriggerApis.length > 0
            ? options.navDestinationTriggerApis.map(item => ({
                canonicalApiIds: [...new Set(item.canonicalApiIds || [])].sort((left, right) => left.localeCompare(right)),
                routeField: item.routeField,
                routeArgIndex: item.routeArgIndex,
                payloadArgIndex: item.payloadArgIndex,
                payloadField: item.payloadField,
            }))
            : DEFAULT_ROUTER_OPTIONS.navDestinationTriggerApis.map(item => ({
                canonicalApiIds: [...item.canonicalApiIds],
                routeField: item.routeField,
                routeArgIndex: item.routeArgIndex,
                payloadArgIndex: item.payloadArgIndex,
                payloadField: item.payloadField,
            })),
        payloadUnwrapPrefixes: options.payloadUnwrapPrefixes && options.payloadUnwrapPrefixes.length > 0
            ? [...options.payloadUnwrapPrefixes]
            : [...DEFAULT_ROUTER_OPTIONS.payloadUnwrapPrefixes],
    };
    const pushApiByCanonicalApiId = routeApiByCanonicalApiId(resolved.pushApis);
    const getApiByCanonicalApiId = getRouteApiByCanonicalApiId(resolved.getApis);
    const navDestinationRegisterApiByCanonicalApiId = registerApiByCanonicalApiId(resolved.navDestinationRegisterApis);
    const navDestinationTriggerApiByCanonicalApiId = routeApiByCanonicalApiId(resolved.navDestinationTriggerApis);
    const internalOptions: BuildRouterInternalOptions = {
        pushCanonicalApiIds: new Set(resolved.pushApis.flatMap(item =>
            item.canonicalApiIds.map(value => String(value || "").trim()).filter(Boolean),
        )),
        getCanonicalApiIds: new Set([
            ...resolved.getCanonicalApiIds.map(value => value.trim()).filter(Boolean),
            ...getApiByCanonicalApiId.keys(),
        ]),
        getApiByCanonicalApiId,
        navDestinationRegisterCanonicalApiIds: new Set(navDestinationRegisterApiByCanonicalApiId.keys()),
        navDestinationTriggerCanonicalApiIds: new Set(navDestinationTriggerApiByCanonicalApiId.keys()),
        payloadUnwrapPrefixes: [...resolved.payloadUnwrapPrefixes],
        routeFieldByPushCanonicalApiId: routeFieldByPushCanonicalApiId(resolved.pushApis),
        pushApiByCanonicalApiId,
        navDestinationRegisterApiByCanonicalApiId,
        navDestinationTriggerApiByCanonicalApiId,
    };

    return defineModule({
        id: resolved.id,
        description: resolved.description,
        setup(ctx) {
            const model = buildRouterModel({
                scene: ctx.raw.scene,
                pag: ctx.raw.pag,
                allowedMethodSignatures: ctx.raw.allowedMethodSignatures,
                scan: ctx.scan,
                analysis: ctx.analysis,
                callbacks: ctx.callbacks,
                log: ctx.log,
            }, internalOptions);
        const navCallbackMethodsByRouteKey = collectNavDestinationCallbackMethods(ctx, internalOptions);
        const navTriggerSitesByRouteKey = collectNavDestinationTriggerSites(ctx, internalOptions);
        let navDeferredBindingCount = 0;
        for (const [routeKey, triggerSites] of navTriggerSitesByRouteKey.entries()) {
            const callbackMethods = navCallbackMethodsByRouteKey.get(routeKey);
            if (!callbackMethods || callbackMethods.size === 0) continue;
            for (const triggerSite of triggerSites) {
                if (!triggerSite.deferredPayloadSource) continue;
                for (const handlerMethod of callbackMethods.values()) {
                    ctx.deferred.declarative({
                        sourceMethod: triggerSite.sourceMethod,
                        handlerMethod,
                        anchorStmt: triggerSite.anchorStmt,
                        triggerLabel: routeKey,
                        activationSource: triggerSite.deferredActivationSource,
                        payloadSource: triggerSite.deferredPayloadSource,
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

        const handoff = createHandoffPropagationSession(buildRouterHandoffEffects(
            model,
            navTriggerSitesByRouteKey,
            internalOptions,
        ), {
            currentnessAnalysis: ctx.raw.currentnessAnalysis,
        });

        return {
            onFact(event) {
                return handoff.emitForFact(event);
            },
        };
        },
    });
}

export const harmonyRouterSemanticModule = createHarmonyRouteBridgeSemanticModule();
export const harmonyRouterModule: TaintModule = harmonyRouterSemanticModule;

type RouterModel = RouterSemanticModel;
type BuildRouterModelArgs = BuildRouterSemanticModelArgs;

interface NavDestinationTriggerSite {
    sourceMethod: any;
    anchorStmt: any;
    argNodeIds: number[];
    deferredActivationSource?: { kind: "arg"; index: number };
    deferredPayloadSource?: { kind: "arg"; index: number };
}

const ROUTER_BRIDGE_HANDOFF_FAMILY = "harmony.router.bridge";
const ROUTER_FIELD_HANDOFF_FAMILY = "harmony.router.field";
const ROUTER_TRIGGER_HANDOFF_FAMILY = "harmony.router.trigger";
const ROUTER_CELL_KIND = "navigation-param-slot";

function routeFieldByPushCanonicalApiId(pushApis: HarmonyRoutePushApiOption[]): Map<string, string> {
    const out = new Map<string, string>();
    for (const api of pushApis) {
        if (!api.routeField) continue;
        for (const canonicalApiId of api.canonicalApiIds || []) {
            const normalized = String(canonicalApiId || "").trim();
            if (!normalized) continue;
            out.set(normalized, api.routeField);
        }
    }
    return out;
}

function routeApiByCanonicalApiId(pushApis: HarmonyRoutePushApiOption[]): Map<string, HarmonyRoutePushApiOption> {
    const out = new Map<string, HarmonyRoutePushApiOption>();
    for (const api of pushApis) {
        for (const canonicalApiId of api.canonicalApiIds || []) {
            const normalized = String(canonicalApiId || "").trim();
            if (!normalized) continue;
            out.set(normalized, api);
        }
    }
    return out;
}

function getRouteApiByCanonicalApiId(getApis: HarmonyRouteGetApiOption[]): Map<string, HarmonyRouteGetApiOption> {
    const out = new Map<string, HarmonyRouteGetApiOption>();
    for (const api of getApis) {
        for (const canonicalApiId of api.canonicalApiIds || []) {
            const normalized = String(canonicalApiId || "").trim();
            if (!normalized) continue;
            out.set(normalized, api);
        }
    }
    return out;
}

function registerApiByCanonicalApiId(registerApis: HarmonyRouteRegisterApiOption[]): Map<string, HarmonyRouteRegisterApiOption> {
    const out = new Map<string, HarmonyRouteRegisterApiOption>();
    for (const api of registerApis) {
        for (const canonicalApiId of api.canonicalApiIds || []) {
            const normalized = String(canonicalApiId || "").trim();
            if (!normalized) continue;
            out.set(normalized, api);
        }
    }
    return out;
}

function buildRouterHandoffEffects(
    model: RouterModel,
    navTriggerSitesByRouteKey: Map<string, NavDestinationTriggerSite[]>,
    options: BuildRouterInternalOptions,
): HandoffEffect[] {
    const effects: HandoffEffect[] = [];

    for (const [nodeId, routerKeys] of model.pushArgNodeIdToRouterKeys.entries()) {
        for (const routerKey of routerKeys) {
            addRouterSourceEffects(effects, model, routerKey, { nodeId }, navTriggerSitesByRouteKey, options);
        }
    }

    for (const [endpointKey, routerKeys] of model.pushFieldEndpointToRouterKeys.entries()) {
        const [nodeIdText, fieldHead] = endpointKey.split("#");
        const nodeId = Number(nodeIdText);
        if (!Number.isFinite(nodeId) || !fieldHead) continue;
        for (const routerKey of routerKeys) {
            addRouterSourceEffects(
                effects,
                model,
                routerKey,
                { nodeId, fieldHead, endpointKey },
                navTriggerSitesByRouteKey,
                options,
            );
        }
    }

    for (const [sourceNodeId, targets] of model.pushValueFieldTargetsByNodeId.entries()) {
        for (const target of targets) {
            const handle = createExactHandoffHandle(
                ROUTER_CELL_KIND,
                ROUTER_FIELD_HANDOFF_FAMILY,
                `value:${sourceNodeId}:${target.routerKey}:${target.fieldName}:${target.passthrough ? "pass" : "prefix"}:${target.sourceFieldPath?.join(".") || ""}`,
            );
            effects.push({
                kind: "put",
                handle,
                source: {
                    nodeId: sourceNodeId,
                    fieldPathPrefix: target.sourceFieldPath && target.sourceFieldPath.length > 0
                        ? [...target.sourceFieldPath]
                        : undefined,
                },
                reason: "Harmony-RouterField",
                originModel: "harmony.router",
            });
            const resultObjectIds = model.getResultObjectNodeIdsByRouterKey.get(target.routerKey);
            const resultNodeIds = model.getResultNodeIdsByRouterKey.get(target.routerKey);
            const currentField = target.sourceFieldPath && target.sourceFieldPath.length > 0
                ? {
                    mode: "prefix" as const,
                    prefix: [target.fieldName],
                    stripPrefixes: [target.sourceFieldPath],
                    unwrapPrefixes: options.payloadUnwrapPrefixes,
                }
                : target.passthrough
                    ? { mode: "preserve" as const, unwrapPrefixes: options.payloadUnwrapPrefixes }
                    : { mode: "prefix" as const, prefix: [target.fieldName], unwrapPrefixes: options.payloadUnwrapPrefixes };
            if (resultObjectIds && resultObjectIds.size > 0) {
                for (const objectNodeId of resultObjectIds) {
                    effects.push({
                        kind: "get",
                        handle,
                        target: {
                            nodeId: objectNodeId,
                            currentField,
                            preserveSourceField: false,
                        },
                        reason: "Harmony-RouterField",
                        originModel: "harmony.router",
                    });
                }
                continue;
            }
            if (resultNodeIds && resultNodeIds.size > 0) {
                for (const targetNodeId of resultNodeIds) {
                    effects.push({
                        kind: "get",
                        handle,
                        target: {
                            nodeId: targetNodeId,
                            currentField,
                            allowUnreachableTarget: true,
                            preserveSourceField: false,
                        },
                        reason: "Harmony-RouterField",
                        originModel: "harmony.router",
                    });
                }
            }
            const fieldResultNodeIds = model.getFieldResultNodeIdsByRouterKey
                .get(target.routerKey)
                ?.get(target.fieldName);
            if (fieldResultNodeIds && fieldResultNodeIds.size > 0) {
                for (const targetNodeId of fieldResultNodeIds) {
                    effects.push({
                        kind: "get",
                        handle,
                        target: {
                            nodeId: targetNodeId,
                            allowUnreachableTarget: true,
                            preserveSourceField: false,
                        },
                        reason: "Harmony-RouterField",
                        originModel: "harmony.router",
                    });
                }
            }
        }
    }

    return effects;
}

function addRouterSourceEffects(
    effects: HandoffEffect[],
    model: RouterModel,
    routerKey: string,
    source: { nodeId: number; fieldHead?: string; endpointKey?: string },
    navTriggerSitesByRouteKey: Map<string, NavDestinationTriggerSite[]>,
    options: BuildRouterInternalOptions,
): void {
    const triggerHandle = createExactHandoffHandle(ROUTER_CELL_KIND, ROUTER_TRIGGER_HANDOFF_FAMILY, routerKey);
    effects.push({
        kind: "put",
        handle: triggerHandle,
        source: { nodeId: source.nodeId, fieldHead: source.fieldHead },
        reason: "Harmony-RouterTrigger",
        originModel: "harmony.router",
    });
    const triggerSites = navTriggerSitesByRouteKey.get(routerKey);
    if (triggerSites && triggerSites.length > 0) {
        const triggerArgNodeIds = new Set<number>();
        for (const triggerSite of triggerSites) {
            for (const nodeId of triggerSite.argNodeIds) {
                triggerArgNodeIds.add(nodeId);
            }
        }
        for (const targetNodeId of triggerArgNodeIds) {
            effects.push({
                kind: "get",
                handle: triggerHandle,
                target: {
                    nodeId: targetNodeId,
                    allowUnreachableTarget: true,
                    preserveSourceField: false,
                },
                reason: "Harmony-RouterTrigger",
                originModel: "harmony.router",
            });
        }
    }

    if (!shouldSkipRouterBridgeSource(model, routerKey, source)) {
        const bridgeHandle = createExactHandoffHandle(ROUTER_CELL_KIND, ROUTER_BRIDGE_HANDOFF_FAMILY, routerKey);
        effects.push({
            kind: "put",
            handle: bridgeHandle,
            source: { nodeId: source.nodeId, fieldHead: source.fieldHead },
            reason: "Harmony-RouterBridge",
            originModel: "harmony.router",
        });
        const targetNodeIds = model.getResultNodeIdsByRouterKey.get(routerKey);
        if (targetNodeIds && targetNodeIds.size > 0) {
            for (const targetNodeId of targetNodeIds) {
                effects.push({
                    kind: "get",
                    handle: bridgeHandle,
                    target: {
                        nodeId: targetNodeId,
                        currentField: {
                            mode: "preserve",
                            unwrapPrefixes: options.payloadUnwrapPrefixes,
                        },
                        preserveSourceField: false,
                    },
                    reason: "Harmony-RouterBridge",
                    originModel: "harmony.router",
                });
            }
        }

        const fieldResultNodeIdsByField = model.getFieldResultNodeIdsByRouterKey.get(routerKey);
        if (fieldResultNodeIdsByField && fieldResultNodeIdsByField.size > 0) {
            for (const [fieldName, fieldResultNodeIds] of fieldResultNodeIdsByField.entries()) {
                if (!fieldName || fieldResultNodeIds.size === 0) continue;
                const sourceFieldPrefixes = resolveRouterFieldResultSourcePrefixes(fieldName, options.payloadUnwrapPrefixes);
                for (const sourceFieldPrefix of sourceFieldPrefixes) {
                    const fieldResultHandle = createExactHandoffHandle(
                        ROUTER_CELL_KIND,
                        ROUTER_FIELD_HANDOFF_FAMILY,
                        `field-result:${routerKey}:${source.nodeId}:${sourceFieldPrefix.join(".")}`,
                    );
                    effects.push({
                        kind: "put",
                        handle: fieldResultHandle,
                        source: {
                            nodeId: source.nodeId,
                            fieldPathPrefix: sourceFieldPrefix,
                        },
                        reason: "Harmony-RouterFieldResult",
                        originModel: "harmony.router",
                    });
                    for (const targetNodeId of fieldResultNodeIds) {
                        effects.push({
                            kind: "get",
                            handle: fieldResultHandle,
                            target: {
                                nodeId: targetNodeId,
                                allowUnreachableTarget: true,
                                preserveSourceField: false,
                            },
                            reason: "Harmony-RouterFieldResult",
                            originModel: "harmony.router",
                        });
                    }
                }
            }
        }
    }

    if (source.fieldHead) {
        const objectHandle = createExactHandoffHandle(ROUTER_CELL_KIND, ROUTER_FIELD_HANDOFF_FAMILY, `object:${routerKey}`);
        effects.push({
            kind: "put",
            handle: objectHandle,
            source: { nodeId: source.nodeId, fieldHead: source.fieldHead },
            reason: "Harmony-RouterField",
            originModel: "harmony.router",
        });
        const resultObjectIds = model.getResultObjectNodeIdsByRouterKey.get(routerKey);
        if (resultObjectIds && resultObjectIds.size > 0) {
            for (const objectNodeId of resultObjectIds) {
                effects.push({
                    kind: "get",
                    handle: objectHandle,
                    target: {
                        nodeId: objectNodeId,
                        currentField: {
                            mode: "preserve",
                            unwrapPrefixes: options.payloadUnwrapPrefixes,
                            requireField: true,
                        },
                        preserveSourceField: false,
                    },
                    reason: "Harmony-RouterField",
                    originModel: "harmony.router",
                });
            }
        }
    }
}

function resolveRouterFieldResultSourcePrefixes(fieldName: string, unwrapPrefixes: string[]): string[][] {
    const out: string[][] = [[fieldName]];
    const seen = new Set<string>([fieldName]);
    for (const prefix of unwrapPrefixes || []) {
        const normalizedPrefix = String(prefix || "").trim();
        if (!normalizedPrefix) continue;
        const path = [normalizedPrefix, fieldName];
        const key = path.join(".");
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(path);
    }
    return out;
}

function shouldSkipRouterBridgeSource(
    model: RouterModel,
    routerKey: string,
    source: { nodeId: number; endpointKey?: string },
): boolean {
    const targetNodeIds = model.getResultNodeIdsByRouterKey.get(routerKey);
    if (!targetNodeIds || targetNodeIds.size === 0) return false;
    const isUngroupedPush = model.ungroupedPushNodeIds.has(source.nodeId)
        || (!!source.endpointKey && model.ungroupedPushFieldEndpoints.has(source.endpointKey));
    if (!isUngroupedPush) return false;
    const pushCount = model.pushCallCountByRouterKey.get(routerKey) || 0;
    const routeCount = model.distinctRouteKeyCountByRouterKey.get(routerKey) || 0;
    const hasAmbiguousTargets = targetNodeIds.size > 1;
    const hasAmbiguousRoutes = routeCount === 0 || routeCount > 1;
    return pushCount > 1 && hasAmbiguousTargets && hasAmbiguousRoutes;
}

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

export function buildRouterModel(
    args: BuildRouterModelArgs,
    options: BuildRouterInternalOptions = {
        pushCanonicalApiIds: new Set(),
        getCanonicalApiIds: new Set(),
        getApiByCanonicalApiId: new Map(),
        navDestinationRegisterCanonicalApiIds: new Set(),
        navDestinationTriggerCanonicalApiIds: new Set(),
        payloadUnwrapPrefixes: [...DEFAULT_ROUTER_OPTIONS.payloadUnwrapPrefixes],
        routeFieldByPushCanonicalApiId: new Map(),
        pushApiByCanonicalApiId: new Map(),
        navDestinationRegisterApiByCanonicalApiId: new Map(),
        navDestinationTriggerApiByCanonicalApiId: new Map(),
    },
): RouterModel {
    const pushArgNodeIdsByRouterKey = new Map<string, Set<number>>();
    const pushArgNodeIdToRouterKeys = new Map<number, Set<string>>();
    const pushFieldEndpointToRouterKeys = new Map<string, Set<string>>();
    const pushValueFieldTargetsByNodeId = new Map<number, RouterValueFieldTarget[]>();
    const getResultNodeIdsByRouterKey = new Map<string, Set<number>>();
    const getResultObjectNodeIdsByRouterKey = new Map<string, Set<number>>();
    const getFieldResultNodeIdsByRouterKey = new Map<string, Map<string, Set<number>>>();
    const ungroupedPushNodeIds = new Set<number>();
    const ungroupedPushFieldEndpoints = new Set<string>();
    const pushCallCountByRouterKey = new Map<string, number>();
    const routeKeysByRouterKey = new Map<string, Set<string>>();

    let pushCallCount = 0;
    let getCallCount = 0;
    let suspiciousCallCount = 0;
    const instInitPayloadSummaryCache = new Map<string, InstInitPayloadSummary>();

    for (const call of scanCanonicalRouterCalls(args.scan, options.pushCanonicalApiIds, args.analysis)) {
        const method = call.stmt?.getCfg?.()?.getDeclaringMethod?.();
        const invokeExpr = call.invokeExpr;
        if (!method || !invokeExpr) continue;
        if (!(invokeExpr instanceof ArkStaticInvokeExpr || invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
        const pushRouterKey = resolveCanonicalRouterKey(call);
        if (!pushRouterKey) continue;
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
            call.call.canonicalApiId || "",
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
                sourceFieldPath: target.sourceFieldPath,
            });
            for (const routeKey of routeKeys) {
                existing.push({
                    fieldName: target.fieldName,
                    routerKey: routeKey,
                    ungrouped: routeKeys.length === 0,
                    passthrough: target.passthrough,
                    sourceFieldPath: target.sourceFieldPath,
                });
            }
            pushValueFieldTargetsByNodeId.set(target.nodeId, dedupeRouterValueFieldTargets(existing));
        }
    }

    for (const call of scanCanonicalRouterCalls(args.scan, options.getCanonicalApiIds, args.analysis)) {
        const stmt = call.stmt;
        const method = stmt?.getCfg?.()?.getDeclaringMethod?.();
        if (!method || !(stmt instanceof ArkAssignStmt)) continue;
        const getRouterKey = resolveCanonicalRouterKey(call);
        if (!getRouterKey) continue;
        getCallCount++;
        const leftOp = stmt.getLeftOp();
        const nodes = args.pag.getNodesByValue(leftOp);
        if (!nodes || nodes.size === 0) continue;
        const getApi = options.getApiByCanonicalApiId.get(call.call.canonicalApiId || "");
        const explicitGetKeys = collectRouteKeysForGetApi(args.analysis, call.invokeExpr, getRouterKey, getApi);
        const scopedGetKeys = explicitGetKeys.length > 0
            ? explicitGetKeys
            : inferRouteKeysForGetMethod(method, getRouterKey, options);
        const targetRouterKeys = scopedGetKeys.length > 0 ? scopedGetKeys : [getRouterKey];
        for (const nodeId of nodes.values()) {
            const node = args.pag.getNode(nodeId) as PagNode | undefined;
            const pointTo = node?.getPointTo?.();
            for (const targetRouterKey of targetRouterKeys) {
                addMapSetValue(getResultNodeIdsByRouterKey, targetRouterKey, nodeId);
                if (pointTo) {
                    for (const objId of pointTo) {
                        addMapSetValue(getResultObjectNodeIdsByRouterKey, targetRouterKey, objId);
                    }
                }
            }
        }
        collectGetResultFieldReadTargets(
            args.pag,
            method.getCfg?.()?.getStmts?.() || [],
            leftOp,
            targetRouterKeys,
            getFieldResultNodeIdsByRouterKey,
        );
    }

    for (const call of scanCanonicalRouterCalls(args.scan, options.navDestinationRegisterCanonicalApiIds, args.analysis)) {
        const registerApi = options.navDestinationRegisterApiByCanonicalApiId.get(call.call.canonicalApiId || "");
        if (!registerApi) continue;
        const method = call.stmt?.getCfg?.()?.getDeclaringMethod?.();
        const invokeExpr = call.invokeExpr;
        if (!method || !invokeExpr) continue;
        const navRouteKeys = collectNavDestinationRouteKeys(args.analysis, method, invokeExpr);
        const registerRouterKey = resolveCanonicalRouterKey(call);
        const callbackParamNodeIds = collectCallbackParamNodeIds(
            args.callbacks,
            invokeExpr,
            registerApi.callbackArgIndex,
            registerApi.payloadParamIndex,
        );
        if (callbackParamNodeIds.size === 0) continue;
        for (const routeKey of navRouteKeys.length > 0 ? navRouteKeys : [registerRouterKey].filter(Boolean) as string[]) {
            for (const nodeId of callbackParamNodeIds) {
                addMapSetValue(getResultNodeIdsByRouterKey, routeKey, nodeId);
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
        getFieldResultNodeIdsByRouterKey,
        ungroupedPushNodeIds,
        ungroupedPushFieldEndpoints,
        pushCallCountByRouterKey,
        distinctRouteKeyCountByRouterKey: buildDistinctRouteKeyCountByRouterKey(routeKeysByRouterKey),
        pushCallCount,
        getCallCount,
        suspiciousCallCount,
    };
}

function inferRouteKeysForGetMethod(
    method: any,
    routerKey: string,
    options: BuildRouterInternalOptions,
): string[] {
    const classSig = method?.getSignature?.()?.getDeclaringClassSignature?.();
    const fileText = String(classSig?.getDeclaringFileSignature?.()?.toString?.() || "");
    const route = inferPageRouteFromFileSignature(fileText);
    if (!route) return [];
    const routeField = "url";
    const keys = new Set<string>();
    keys.add(`${routerKey}::${routeField}=${route}`);
    keys.add(`${routeField}=${route}`);
    keys.add(`route=${route}`);
    for (const pushRouteField of options.routeFieldByPushCanonicalApiId.values()) {
        keys.add(`${routerKey}::${pushRouteField}=${route}`);
        keys.add(`${pushRouteField}=${route}`);
    }
    return [...keys];
}

function collectRouteKeysForGetApi(
    analysis: BuildRouterModelArgs["analysis"],
    invokeExpr: any,
    routerKey: string,
    getApi: HarmonyRouteGetApiOption | undefined,
): string[] {
    if (!getApi || !Number.isInteger(getApi.routeArgIndex)) return [];
    const args = invokeExpr?.getArgs?.() || [];
    const routeArgIndex = Number(getApi.routeArgIndex);
    if (routeArgIndex < 0 || routeArgIndex >= args.length) return [];
    const routeField = String(getApi.routeField || "name").trim() || "name";
    const keys = new Set<string>();
    for (const literal of analysis.stringCandidates(args[routeArgIndex])) {
        const normalized = literal.trim();
        if (!normalized) continue;
        keys.add(`${routerKey}::${routeField}=${normalized}`);
        keys.add(`${routeField}=${normalized}`);
        keys.add(`route=${normalized}`);
    }
    return [...keys];
}

function inferPageRouteFromFileSignature(fileText: string): string {
    const normalized = fileText
        .replace(/^@[^/\\]+[/\\]/, "")
        .replace(/:\s*$/, "")
        .replace(/\\/g, "/")
        .trim();
    const match = normalized.match(/(?:^|\/)(pages\/.+?)\.ets$/);
    return match ? match[1] : "";
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

function collectDeclaringClassThisObjectNodeIdsForLoweredFieldRef(
    scene: Scene,
    pag: Pag,
    fieldRef: ArkInstanceFieldRef,
): Set<number> {
    const out = new Set<number>();
    const declaringClassName = getFieldDeclaringClassName(fieldRef);
    if (!declaringClassName) return out;
    const declaringFile = getFieldDeclaringFileText(fieldRef);

    for (const method of scene.getMethods()) {
        const methodSig = method.getSignature?.();
        const classSig = methodSig?.getDeclaringClassSignature?.();
        const className = classSig?.getClassName?.() || "";
        if (className !== declaringClassName) continue;
        if (declaringFile) {
            const methodFile = classSig?.getDeclaringFileSignature?.()?.toString?.() || "";
            if (methodFile && methodFile !== declaringFile) continue;
        }
        for (const nodeId of collectMethodThisCarrierAndObjectNodeIds(pag, method)) {
            out.add(nodeId);
        }
    }

    return out;
}

function collectMethodThisCarrierAndObjectNodeIds(pag: Pag, method: any): Set<number> {
    const out = new Set<number>();
    const addThisLocal = (value: any): void => {
        const carrierNodes = pag.getNodesByValue(value);
        if (carrierNodes) {
            for (const nodeId of carrierNodes.values()) {
                out.add(Number(nodeId));
            }
        }
        for (const objectNodeId of collectObjectNodeIdsFromValue(pag, value)) {
            out.add(Number(objectNodeId));
        }
    };

    const body = method?.getBody?.();
    const bodyThis = body?.getLocals?.()?.get?.("this");
    if (bodyThis instanceof Local) {
        addThisLocal(bodyThis);
    }

    const cfg = method?.getCfg?.();
    if (!cfg) return out;
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof Local) || left.getName() !== "this") continue;
        addThisLocal(left);
    }
    return out;
}

function getFieldDeclaringClassName(fieldRef: ArkInstanceFieldRef): string {
    const fieldSig = fieldRef.getFieldSignature?.();
    const declaringSig = (fieldSig as any)?.getDeclaringClassSignature?.()
        || (fieldSig as any)?.getDeclaringSignature?.();
    const direct = declaringSig?.getClassName?.();
    if (direct) return String(direct);
    const text = fieldSig?.toString?.() || "";
    const match = text.match(/:\s*([^:.>]+)\.[^>.]+>?\s*$/);
    return match ? match[1] : "";
}

function getFieldDeclaringFileText(fieldRef: ArkInstanceFieldRef): string {
    const fieldSig = fieldRef.getFieldSignature?.();
    const declaringSig = (fieldSig as any)?.getDeclaringClassSignature?.()
        || (fieldSig as any)?.getDeclaringSignature?.();
    return declaringSig?.getDeclaringFileSignature?.()?.toString?.() || "";
}

function getValueTypeClassName(value: any): string {
    const text = String(value?.getType?.()?.toString?.() || "").trim();
    if (!text) return "";
    const match = text.match(/:\s*([^>]+)$/);
    return (match ? match[1] : text).trim();
}

function collectLocalFieldOrigins(
    stmts: any[],
): Map<string, { base: any; sourceFieldName: string; fieldRef: ArkInstanceFieldRef }> {
    const out = new Map<string, { base: any; sourceFieldName: string; fieldRef: ArkInstanceFieldRef }>();
    for (const stmt of stmts) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof Local)) continue;
        const right = stmt.getRightOp();
        if (!(right instanceof ArkInstanceFieldRef)) continue;
        const sourceFieldName = right.getFieldSignature?.().getFieldName?.() || "";
        if (!sourceFieldName) continue;
        out.set(left.getName(), {
            base: right.getBase?.(),
            sourceFieldName,
            fieldRef: right,
        });
    }
    return out;
}

function collectGetResultFieldReadTargets(
    pag: Pag,
    stmts: any[],
    getResultValue: any,
    routerKeys: string[],
    output: Map<string, Map<string, Set<number>>>,
): void {
    const aliases = collectLocalAliasesForValue(stmts, getResultValue);
    if (aliases.size === 0) return;
    for (const stmt of stmts) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const right = stmt.getRightOp();
        if (!(right instanceof ArkInstanceFieldRef)) continue;
        const base = right.getBase?.();
        if (!(base instanceof Local)) continue;
        if (!aliases.has(base)) continue;
        const fieldName = right.getFieldSignature?.().getFieldName?.() || "";
        if (!fieldName) continue;
        const dstNodes = pag.getNodesByValue(stmt.getLeftOp());
        if (!dstNodes || dstNodes.size === 0) continue;
        for (const routerKey of routerKeys) {
            for (const nodeId of dstNodes.values()) {
                addNestedMapSetValue(output, routerKey, fieldName, nodeId);
            }
        }
    }
}

function collectLocalAliasesForValue(stmts: any[], seedValue: any): Set<Local> {
    const aliases = new Set<Local>();
    const addAlias = (value: any): boolean => {
        if (!(value instanceof Local)) return false;
        const before = aliases.size;
        aliases.add(value);
        return aliases.size !== before;
    };
    addAlias(seedValue);
    let changed = true;
    while (changed) {
        changed = false;
        for (const stmt of stmts) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            if (!(left instanceof Local)) continue;
            const right = unwrapCastExpression(stmt.getRightOp());
            if (!(right instanceof Local)) continue;
            if (!aliases.has(right)) continue;
            changed = addAlias(left) || changed;
        }
    }
    return aliases;
}

function unwrapCastExpression(value: any): any {
    let current = value;
    for (let i = 0; i < 3; i++) {
        if (!(current instanceof ArkCastExpr)) return current;
        current = current.getOp?.();
    }
    return current;
}

function addNestedMapSetValue<K1, K2, V>(
    map: Map<K1, Map<K2, Set<V>>>,
    key1: K1,
    key2: K2,
    value: V,
): void {
    let inner = map.get(key1);
    if (!inner) {
        inner = new Map<K2, Set<V>>();
        map.set(key1, inner);
    }
    addMapSetValue(inner, key2, value);
}

interface PushPayloadResult {
    payloadNodeIds: Set<number>;
    payloadFieldEndpoints: Array<{ objectNodeId: number; fieldName: string }>;
    payloadValueFieldTargets: Array<{ nodeId: number; fieldName: string; passthrough?: boolean; sourceFieldPath?: string[] }>;
    routeLiteralKeys: string[];
}

interface InstInitPayloadSummary {
    payloadNodeIds: Set<number>;
    payloadFieldEndpoints: Array<{ objectNodeId: number; fieldName: string }>;
    payloadValueFieldTargets: Array<{ nodeId: number; fieldName: string; passthrough?: boolean; sourceFieldPath?: string[] }>;
    routeLiterals: string[];
}

interface InstInitSpecificPayloadFieldSummary {
    payloadNodeIds: Set<number>;
    payloadValueFieldTargets: Array<{ nodeId: number; fieldName: string; passthrough?: boolean; sourceFieldPath?: string[] }>;
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
    pushCanonicalApiId: string,
    options: BuildRouterInternalOptions,
): PushPayloadResult {
    const out = new Set<number>();
    const payloadFieldEndpoints = new Map<string, { objectNodeId: number; fieldName: string }>();
    const payloadValueFieldTargets = new Map<string, { nodeId: number; fieldName: string; passthrough?: boolean; sourceFieldPath?: string[] }>();
    const routeLiteralKeys = new Set<string>();
    const cfg = method.getCfg?.();
    const stmts = cfg ? cfg.getStmts() : [];
    const argsList = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    const pushApi = options.pushApiByCanonicalApiId.get(pushCanonicalApiId);
    const routeFieldName = resolveRouteFieldNameForPushApi(pushCanonicalApiId, options);
    const routeArgIndex = Number.isInteger(pushApi?.routeArgIndex) ? pushApi!.routeArgIndex : undefined;
    const payloadArgIndex = Number.isInteger(pushApi?.payloadArgIndex) ? pushApi!.payloadArgIndex : undefined;
    const payloadField = pushApi?.payloadField?.trim();
    const visitedLocals = new Set<string>();
    const payloadContainerFieldNames = new Set(["param", "params"]);
    const localFieldOrigins = collectLocalFieldOrigins(stmts);

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
        if (routeFieldName) {
            routeLiteralKeys.add(`${routerKey}::${routeFieldName}=${normalized}`);
            routeLiteralKeys.add(`${routeFieldName}=${normalized}`);
        }
        routeLiteralKeys.add(`route=${normalized}`);
    };

    const addRouteLiteralsFromValue = (value: any): void => {
        for (const literal of analysis.stringCandidates(value)) {
            addRouteLiteral(literal);
        }
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

    const addValueFieldTarget = (value: any, fieldName: string, passthrough = false, sourceFieldPath?: string[]): void => {
        if (!fieldName) return;
        const nodeIds = new Set<number>();
        const nodes = pag.getNodesByValue(value);
        if (nodes) {
            for (const nodeId of nodes.values()) {
                nodeIds.add(nodeId);
            }
        }
        for (const objectNodeId of collectObjectNodeIdsFromValue(pag, value)) {
            nodeIds.add(objectNodeId);
        }
        if (nodeIds.size === 0) return;
        for (const nodeId of nodeIds) {
            payloadValueFieldTargets.set(
                `${nodeId}#${fieldName}#${passthrough ? "pass" : "prefix"}#${sourceFieldPath?.join(".") || ""}`,
                { nodeId, fieldName, passthrough, sourceFieldPath },
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
                `${target.nodeId}#${target.fieldName}#${target.passthrough ? "pass" : "prefix"}#${target.sourceFieldPath?.join(".") || ""}`,
                target,
            );
        }
        for (const literal of summary.routeLiterals) {
            addRouteLiteral(literal);
        }
    };

    const collectSpecificPayloadFieldFromLocal = (local: Local, fieldName: string): void => {
        addFieldEndpointFromBaseValue(local, fieldName);
        for (const stmt of stmts) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            if (!(left instanceof ArkInstanceFieldRef)) continue;
            if (left.getBase() !== local) continue;
            const currentFieldName = left.getFieldSignature?.().getFieldName?.() || "";
            if (currentFieldName !== fieldName) continue;
            const right = stmt.getRightOp();
            addNodesFromValue(right);
            addValueFieldTarget(right, fieldName, true);
            if (routeFieldName && currentFieldName === routeFieldName) {
                addRouteLiteralsFromValue(right);
            }
        }
    };

    const collectSpecificPayloadFieldFromInstInit = (local: Local, fieldName: string): void => {
        const classType = String(local.getType?.()?.toString?.() || "").trim();
        if (!classType) return;
        const summary = collectInstInitSpecificPayloadFieldSummary(
            scene,
            pag,
            analysis,
            classType,
            routeFieldName,
            fieldName,
            new Set<string>(),
        );
        for (const nodeId of summary.payloadNodeIds) {
            out.add(nodeId);
        }
        for (const target of summary.payloadValueFieldTargets) {
            payloadValueFieldTargets.set(
                `${target.nodeId}#${target.fieldName}#${target.passthrough ? "pass" : "prefix"}#${target.sourceFieldPath?.join(".") || ""}`,
                target,
            );
        }
        for (const literal of summary.routeLiterals) {
            addRouteLiteral(literal);
        }
    };

    const collectRouteFieldFromLocal = (local: Local, fieldName: string): void => {
        for (const stmt of stmts) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            if (!(left instanceof ArkInstanceFieldRef)) continue;
            if (left.getBase() !== local) continue;
            const currentFieldName = left.getFieldSignature?.().getFieldName?.() || "";
            if (currentFieldName !== fieldName) continue;
            addRouteLiteralsFromValue(stmt.getRightOp());
        }
    };

    const collectPayloadArgument = (arg: any): void => {
        if (payloadField) {
            if (arg instanceof Local) {
                if (routeFieldName) {
                    collectRouteFieldFromLocal(arg, routeFieldName);
                }
                collectSpecificPayloadFieldFromLocal(arg, payloadField);
                collectSpecificPayloadFieldFromInstInit(arg, payloadField);
                return;
            }
            if (arg instanceof ArkInstanceFieldRef) {
                const fieldName = arg.getFieldSignature?.().getFieldName?.() || "";
                if (fieldName === payloadField) {
                    addNodesFromValue(arg);
                    addValueFieldTarget(arg, payloadField, true);
                }
            }
            return;
        }

        addNodesFromValue(arg);
        if (arg instanceof Local) {
            collectPayloadFromLocal(arg, 0, false);
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
            const leftBase = left.getBase();
            if (leftBase instanceof ArkInstanceFieldRef && leftBase.getBase() === local) {
                const containerFieldName = leftBase.getFieldSignature?.().getFieldName?.() || "";
                const nestedFieldName = left.getFieldSignature?.().getFieldName?.() || "";
                if (payloadContainerFieldNames.has(containerFieldName) && nestedFieldName) {
                    const right = stmt.getRightOp();
                    addNodesFromValue(right);
                    addValueFieldTarget(right, nestedFieldName);
                    if (routeFieldName && nestedFieldName === routeFieldName) {
                        for (const literal of analysis.stringCandidates(right)) {
                            addRouteLiteral(literal);
                        }
                    }
                    continue;
                }
            }
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
                } else if (right instanceof ArkInstanceFieldRef) {
                    const sourceFieldName = right.getFieldSignature?.().getFieldName?.() || "";
                    if (sourceFieldName) {
                        addValueFieldTarget(right.getBase?.(), fieldName, false, [sourceFieldName]);
                        for (const sourceObjectNodeId of collectDeclaringClassThisObjectNodeIdsForLoweredFieldRef(scene, pag, right)) {
                            payloadValueFieldTargets.set(
                                `${sourceObjectNodeId}#${fieldName}#prefix#${sourceFieldName}`,
                                {
                                    nodeId: sourceObjectNodeId,
                                    fieldName,
                                    passthrough: false,
                                    sourceFieldPath: [sourceFieldName],
                                },
                            );
                        }
                    } else {
                        addValueFieldTarget(right, fieldName);
                    }
                } else if (right instanceof Local && localFieldOrigins.has(right.getName())) {
                    const origin = localFieldOrigins.get(right.getName())!;
                    addValueFieldTarget(origin.base, fieldName, false, [origin.sourceFieldName]);
                    for (const sourceObjectNodeId of collectDeclaringClassThisObjectNodeIdsForLoweredFieldRef(scene, pag, origin.fieldRef)) {
                        payloadValueFieldTargets.set(
                            `${sourceObjectNodeId}#${fieldName}#prefix#${origin.sourceFieldName}`,
                            {
                                nodeId: sourceObjectNodeId,
                                fieldName,
                                passthrough: false,
                                sourceFieldPath: [origin.sourceFieldName],
                            },
                        );
                    }
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

    if (routeArgIndex !== undefined && routeArgIndex >= 0 && routeArgIndex < argsList.length) {
        addRouteLiteralsFromValue(argsList[routeArgIndex]);
    }

    if (payloadArgIndex !== undefined) {
        if (payloadArgIndex >= 0 && payloadArgIndex < argsList.length) {
            collectPayloadArgument(argsList[payloadArgIndex]);
        }
    } else {
        for (const arg of argsList) {
            collectPayloadArgument(arg);
        }
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
        out.set(`${target.fieldName}|${target.routerKey}|${target.passthrough ? "pass" : "prefix"}|${target.sourceFieldPath?.join(".") || ""}`, target);
    }
    return [...out.values()];
}

function collectNavDestinationCallbackMethods(
    ctx: Parameters<NonNullable<TaintModule["setup"]>>[0],
    options: BuildRouterInternalOptions,
): Map<string, Map<string, any>> {
    const out = new Map<string, Map<string, any>>();
    for (const call of scanCanonicalRouterCalls(ctx.scan, options.navDestinationRegisterCanonicalApiIds, ctx.analysis)) {
        const registerApi = options.navDestinationRegisterApiByCanonicalApiId.get(call.call.canonicalApiId || "");
        if (!registerApi) continue;
        if (call.args().length <= registerApi.callbackArgIndex) continue;
        const routeKeys = collectNavDestinationRouteKeys(ctx.analysis, call.stmt?.getCfg?.()?.getDeclaringMethod?.(), call.stmt?.getInvokeExpr?.());
        const registerRouterKey = resolveCanonicalRouterKey(call);
        const callbackValue = call.arg(registerApi.callbackArgIndex);
        const callbackMethods = ctx.callbacks.methods(callbackValue, { maxCandidates: 8 });
        if (callbackMethods.length === 0) continue;
        for (const routeKey of routeKeys.length > 0 ? routeKeys : [registerRouterKey].filter(Boolean) as string[]) {
            let bucket = out.get(routeKey);
            if (!bucket) {
                bucket = new Map<string, any>();
                out.set(routeKey, bucket);
            }
            for (const callbackMethod of callbackMethods) {
                bucket.set(callbackMethod.methodSignature, callbackMethod.method);
            }
        }
    }
    return out;
}

function collectNavDestinationTriggerSites(
    ctx: Parameters<NonNullable<TaintModule["setup"]>>[0],
    options: BuildRouterInternalOptions,
): Map<string, NavDestinationTriggerSite[]> {
    const out = new Map<string, NavDestinationTriggerSite[]>();
    const instInitPayloadSummaryCache = new Map<string, InstInitPayloadSummary>();
    for (const call of scanCanonicalRouterCalls(ctx.scan, options.navDestinationTriggerCanonicalApiIds, ctx.analysis)) {
        const triggerApi = options.navDestinationTriggerApiByCanonicalApiId.get(call.call.canonicalApiId || "");
        if (!triggerApi) continue;
        const sourceMethod = call.stmt?.getCfg?.()?.getDeclaringMethod?.();
        const invokeExpr = call.stmt?.getInvokeExpr?.();
        const routerKey = resolveCanonicalRouterKey(call);
        if (!sourceMethod?.getCfg?.() || !invokeExpr || !routerKey) continue;
        const payload = collectPushPayload(
            ctx.raw.scene,
            sourceMethod,
            invokeExpr,
            ctx.raw.pag,
            ctx.analysis,
            instInitPayloadSummaryCache,
            routerKey,
            call.call.canonicalApiId || "",
            {
                ...options,
                pushApiByCanonicalApiId: new Map([[call.call.canonicalApiId || "", triggerApi]]),
            },
        );
        const routeKeys = payload.routeLiteralKeys.length > 0
            ? payload.routeLiteralKeys
            : [routerKey];
        const argNodeIds = [...payload.payloadNodeIds];
        if (argNodeIds.length === 0) continue;
        const payloadArgIndex = Number.isInteger(triggerApi.payloadArgIndex) ? triggerApi.payloadArgIndex : undefined;
        const routeArgIndex = Number.isInteger(triggerApi.routeArgIndex) ? triggerApi.routeArgIndex : undefined;
        const deferredPayloadSource = payloadArgIndex !== undefined && !triggerApi.payloadField
            ? { kind: "arg" as const, index: payloadArgIndex }
            : undefined;
        const deferredActivationSource = routeArgIndex !== undefined
            ? { kind: "arg" as const, index: routeArgIndex }
            : deferredPayloadSource;
        for (const routeKey of routeKeys) {
            const bucket = out.get(routeKey) || [];
            bucket.push({
                sourceMethod,
                anchorStmt: call.stmt,
                argNodeIds: [...argNodeIds],
                deferredActivationSource,
                deferredPayloadSource,
            });
            out.set(routeKey, bucket);
        }
    }
    return out;
}

function scanCanonicalRouterCalls(
    scan: { invokes(filter?: any): any[] },
    canonicalApiIds: Set<string>,
    analysis: ModuleAnalysisApi,
): ModuleScannedInvoke[] {
    const out = [];
    const seen = new Set<string>();
    for (const canonicalApiId of canonicalApiIds) {
        for (const call of scan.invokes({ canonicalApiId })) {
            if (!hasResolvedModuleSemanticEndpoint(call, analysis)) continue;
            const key = [
                call.ownerMethodSignature,
                call.call.rawOccurrenceId || call.call.occurrenceId || call.call.signature,
                call.stmt?.getOriginPositionInfo?.()?.getLineNo?.() || 0,
                call.stmt?.getOriginPositionInfo?.()?.getColNo?.() || 0,
            ].join("|");
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(call);
        }
    }
    return out;
}

function hasResolvedModuleSemanticEndpoint(
    call: ModuleScannedInvoke,
    analysis: ModuleAnalysisApi,
): boolean {
    for (const semanticSite of call.call.semanticEffectSites || []) {
        if (semanticSite.capability !== "module") continue;
        if (semanticSite.canonicalApiId !== call.call.canonicalApiId) continue;
        if (semanticSite.occurrenceId !== call.call.occurrenceId) continue;
        if (semanticSite.rawOccurrenceId !== call.call.rawOccurrenceId) continue;
        const projection = analysis.projectEndpoint({
            semanticSite,
            endpointSpec: semanticSite.endpointSpec,
            stmt: call.stmt,
            invokeExpr: call.invokeExpr,
            allowNodeCreation: false,
            consumer: "module",
        });
        if (isConsumableSemanticEndpointProjection(projection)) {
            return true;
        }
    }
    return false;
}

function resolveCanonicalRouterKey(call: { call: { canonicalApiId?: string } }): string | undefined {
    const parts = parseCanonicalApiId(call.call.canonicalApiId || "");
    if (!parts) return undefined;
    return `canonical:${parts.authority}:${parts.domain}:${parts.module}`;
}

function collectCallbackParamNodeIds(
    callbacks: BuildRouterModelArgs["callbacks"],
    invokeExpr: any,
    callbackArgIndex: number,
    callbackParamIndex: number,
): Set<number> {
    const out = new Set<number>();
    const invokeArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    if (callbackArgIndex < 0 || callbackArgIndex >= invokeArgs.length) {
        return out;
    }
    const callbackArg = invokeArgs[callbackArgIndex];
    for (const binding of callbacks.paramBindings(callbackArg, callbackParamIndex, { maxCandidates: 8 })) {
        for (const nodeId of binding.localNodeIds()) {
            out.add(nodeId);
        }
        for (const nodeId of binding.localUseNodeIds()) {
            out.add(nodeId);
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
    const valueTargets = new Map<string, { nodeId: number; fieldName: string; passthrough?: boolean; sourceFieldPath?: string[] }>();
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

    const addValueFieldTarget = (value: any, fieldName: string, passthrough = false, sourceFieldPath?: string[]): void => {
        if (!fieldName) return;
        const nodeIds = new Set<number>();
        const nodes = pag.getNodesByValue(value);
        if (nodes) {
            for (const nodeId of nodes.values()) {
                nodeIds.add(nodeId);
            }
        }
        for (const objectNodeId of collectObjectNodeIdsFromValue(pag, value)) {
            nodeIds.add(objectNodeId);
        }
        if (nodeIds.size === 0) return;
        for (const nodeId of nodeIds) {
            valueTargets.set(
                `${nodeId}#${fieldName}#${passthrough ? "pass" : "prefix"}#${sourceFieldPath?.join(".") || ""}`,
                { nodeId, fieldName, passthrough, sourceFieldPath },
            );
        }
    };

    for (const method of scene.getMethods()) {
        if (method.getName() !== "%instInit") continue;
        const methodSig = method.getSignature?.().toString?.() || "";
        if (!instInitPattern.test(methodSig)) continue;
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        const localFieldOrigins = collectLocalFieldOrigins(cfg.getStmts());
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
                            `${target.nodeId}#${target.fieldName}#${target.passthrough ? "pass" : "prefix"}#${target.sourceFieldPath?.join(".") || ""}`,
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
                if (right instanceof ArkInstanceFieldRef) {
                    const sourceFieldName = right.getFieldSignature?.().getFieldName?.() || "";
                    if (sourceFieldName) {
                        addValueFieldTarget(right.getBase?.(), currentField, false, [sourceFieldName]);
                        for (const sourceObjectNodeId of collectDeclaringClassThisObjectNodeIdsForLoweredFieldRef(scene, pag, right)) {
                            valueTargets.set(
                                `${sourceObjectNodeId}#${currentField}#prefix#${sourceFieldName}`,
                                {
                                    nodeId: sourceObjectNodeId,
                                    fieldName: currentField,
                                    passthrough: false,
                                    sourceFieldPath: [sourceFieldName],
                                },
                            );
                        }
                    } else {
                        addValueFieldTarget(right, currentField);
                    }
                } else if (right instanceof Local && localFieldOrigins.has(right.getName())) {
                    const origin = localFieldOrigins.get(right.getName())!;
                    addValueFieldTarget(origin.base, currentField, false, [origin.sourceFieldName]);
                    for (const sourceObjectNodeId of collectDeclaringClassThisObjectNodeIdsForLoweredFieldRef(scene, pag, origin.fieldRef)) {
                        valueTargets.set(
                            `${sourceObjectNodeId}#${currentField}#prefix#${origin.sourceFieldName}`,
                            {
                                nodeId: sourceObjectNodeId,
                                fieldName: currentField,
                                passthrough: false,
                                sourceFieldPath: [origin.sourceFieldName],
                            },
                        );
                    }
                } else {
                    addValueFieldTarget(right, currentField);
                }
            }
        }
    }

    visiting.delete(visitKey);
    out.payloadFieldEndpoints = [...fieldEndpoints.values()];
    out.payloadValueFieldTargets = [...valueTargets.values()];
    out.routeLiterals = [...routeLiterals];
    return out;
}

function collectInstInitSpecificPayloadFieldSummary(
    scene: Scene,
    pag: Pag,
    analysis: BuildRouterModelArgs["analysis"],
    classType: string,
    routeFieldName: string | undefined,
    payloadFieldName: string,
    visiting: Set<string>,
): InstInitSpecificPayloadFieldSummary {
    const out: InstInitSpecificPayloadFieldSummary = {
        payloadNodeIds: new Set<number>(),
        payloadValueFieldTargets: [],
        routeLiterals: [],
    };
    const valueTargets = new Map<string, { nodeId: number; fieldName: string; passthrough?: boolean; sourceFieldPath?: string[] }>();
    const routeLiterals = new Set<string>();
    const normalizedPayloadFieldName = String(payloadFieldName || "").trim();
    if (!classType || !normalizedPayloadFieldName) {
        return out;
    }
    const escapedClassType = escapeForRegex(classType);
    const instInitPattern = new RegExp(`${escapedClassType}\\.\\%instInit\\(`);
    const visitKey = `${classType}|${routeFieldName || ""}|${normalizedPayloadFieldName}`;
    if (visiting.has(visitKey)) {
        return out;
    }
    visiting.add(visitKey);

    const addPayloadValue = (
        value: any,
        fieldName: string,
        passthrough = true,
        sourceFieldPath?: string[],
    ): void => {
        const nodeIds = new Set<number>();
        const nodes = pag.getNodesByValue(value);
        if (nodes) {
            for (const nodeId of nodes.values()) {
                nodeIds.add(nodeId);
            }
        }
        for (const objectNodeId of collectObjectNodeIdsFromValue(pag, value)) {
            nodeIds.add(objectNodeId);
        }
        for (const nodeId of nodeIds) {
            out.payloadNodeIds.add(nodeId);
            valueTargets.set(
                `${nodeId}#${fieldName}#${passthrough ? "pass" : "prefix"}#${sourceFieldPath?.join(".") || ""}`,
                { nodeId, fieldName, passthrough, sourceFieldPath },
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
            if (routeFieldName && currentField === routeFieldName) {
                for (const literal of analysis.stringCandidates(right)) {
                    routeLiterals.add(literal);
                }
            }
            if (currentField !== normalizedPayloadFieldName) continue;
            if (right instanceof ArkInstanceFieldRef) {
                const sourceFieldName = right.getFieldSignature?.().getFieldName?.() || "";
                if (sourceFieldName) {
                    addPayloadValue(right.getBase?.(), currentField, false, [sourceFieldName]);
                    continue;
                }
            }
            addPayloadValue(right, currentField, true);
        }
    }

    visiting.delete(visitKey);
    out.payloadValueFieldTargets = [...valueTargets.values()];
    out.routeLiterals = [...routeLiterals];
    return out;
}

function resolveRouteFieldNameForPushApi(
    canonicalApiId: string,
    options: BuildRouterInternalOptions,
): string | undefined {
    return options.pushApiByCanonicalApiId.get(canonicalApiId)?.routeField
        || options.routeFieldByPushCanonicalApiId.get(canonicalApiId);
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

