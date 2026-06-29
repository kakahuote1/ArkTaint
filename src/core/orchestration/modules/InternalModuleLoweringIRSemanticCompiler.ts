import type {
    ModuleAbilityHandoffSemantic,
    ModuleContainerSemantic,
    ModuleEventEmitterSemantic,
    ModuleHandoffEffectSemantic,
    ModuleKeyedStorageSemantic,
    ModuleRouteBridgeSemantic,
    ModuleSemantic,
    InternalModuleLoweringIR,
    ModuleStateBindingSemantic,
    ModuleCallSurfaceSelector,
} from "../../kernel/contracts/InternalModuleLoweringIR";
import type { ModuleAnalysisApi, ModuleScannedInvoke, TaintModule } from "../../kernel/contracts/ModuleContract";
import type { AssetEndpoint, HandoffHandleTemplate, HandleKeyPartTemplate } from "../../assets/schema";
import type { SemanticEffectSite } from "../../api/effects/SemanticEffectSite";
import {
    formatSemanticEndpointPath,
    type SemanticEndpointProjection,
} from "../../kernel/contracts/PagNodeResolution";
import { createHarmonyAbilityHandoffSemanticModule } from "./harmony_semantics/ability_handoff";
import { createHarmonyKeyedStorageSemanticModule } from "./harmony_semantics/appstorage";
import { createHarmonyEventEmitterSemanticModule } from "./harmony_semantics/emitter";
import { createHarmonyRouteBridgeSemanticModule } from "./harmony_semantics/router";
import { createHarmonyStateBindingSemanticModule } from "./harmony_semantics/state";
import { createTsjsContainerSemanticModule } from "./tsjs_semantics/container";
import { defineModule } from "../../kernel/contracts/ModuleApi";
import { createHandoffPropagationSession } from "../../kernel/semantic_handoff/SemanticHandoffPropagation";
import { createHandoffHandle, type HandoffEffect, type HandoffHandle } from "../../kernel/semantic_handoff/SemanticHandoffTypes";
import { handoffInvokeEffectMeta, pushHandoffKillThenPut } from "./ModuleHandoffEffectUtils";

function compileContainerSemantic(spec: InternalModuleLoweringIR, semantic: ModuleContainerSemantic): TaintModule {
    return createTsjsContainerSemanticModule({
        id: `${spec.id}::${semantic.id}`,
        description: `${spec.description} [${semantic.id}]`,
        families: semantic.families,
        capabilities: semantic.capabilities,
        mutationCanonicalApiIds: semantic.mutationCanonicalApiIds,
        accessCanonicalApiIds: semantic.accessCanonicalApiIds,
    });
}

function compileAbilityHandoffSemantic(spec: InternalModuleLoweringIR, semantic: ModuleAbilityHandoffSemantic): TaintModule {
    return createHarmonyAbilityHandoffSemanticModule({
        id: `${spec.id}::${semantic.id}`,
        description: `${spec.description} [${semantic.id}]`,
        startCanonicalApiIds: semantic.startCanonicalApiIds,
        targetCanonicalApiIds: semantic.targetCanonicalApiIds,
    });
}

function compileEventEmitterSemantic(spec: InternalModuleLoweringIR, semantic: ModuleEventEmitterSemantic): TaintModule {
    return createHarmonyEventEmitterSemanticModule({
        id: `${spec.id}::${semantic.id}`,
        description: `${spec.description} [${semantic.id}]`,
        onCanonicalApiIds: semantic.onCanonicalApiIds,
        emitCanonicalApiIds: semantic.emitCanonicalApiIds,
        channelArgIndexes: semantic.channelArgIndexes,
        payloadArgIndex: semantic.payloadArgIndex,
        callbackArgIndex: semantic.callbackArgIndex,
        callbackParamIndex: semantic.callbackParamIndex,
        maxCandidates: semantic.maxCandidates,
    });
}

function compileKeyedStorageSemantic(spec: InternalModuleLoweringIR, semantic: ModuleKeyedStorageSemantic): TaintModule {
    return createHarmonyKeyedStorageSemanticModule({
        id: `${spec.id}::${semantic.id}`,
        description: `${spec.description} [${semantic.id}]`,
        writeApis: semantic.writeApis,
        writeResultApis: semantic.writeResultApis,
        readCanonicalApiIds: semantic.readCanonicalApiIds,
        killCanonicalApiIds: semantic.killCanonicalApiIds,
        propDecoratorCanonicalApiIds: semantic.propDecoratorCanonicalApiIds,
        linkDecoratorCanonicalApiIds: semantic.linkDecoratorCanonicalApiIds,
    });
}

function compileRouteBridgeSemantic(spec: InternalModuleLoweringIR, semantic: ModuleRouteBridgeSemantic): TaintModule {
    return createHarmonyRouteBridgeSemanticModule({
        id: `${spec.id}::${semantic.id}`,
        description: `${spec.description} [${semantic.id}]`,
        pushApis: semantic.pushApis,
        getCanonicalApiIds: semantic.getCanonicalApiIds,
        getApis: semantic.getApis,
        navDestinationRegisterApis: semantic.navDestinationRegisterApis,
        navDestinationTriggerApis: semantic.navDestinationTriggerApis,
        payloadUnwrapPrefixes: semantic.payloadUnwrapPrefixes,
    });
}

function compileStateBindingSemantic(spec: InternalModuleLoweringIR, semantic: ModuleStateBindingSemantic): TaintModule {
    return createHarmonyStateBindingSemanticModule({
        id: `${spec.id}::${semantic.id}`,
        description: `${spec.description} [${semantic.id}]`,
        stateDecoratorCanonicalApiIds: semantic.stateDecoratorCanonicalApiIds,
        propDecoratorCanonicalApiIds: semantic.propDecoratorCanonicalApiIds,
        linkDecoratorCanonicalApiIds: semantic.linkDecoratorCanonicalApiIds,
        provideDecoratorCanonicalApiIds: semantic.provideDecoratorCanonicalApiIds,
        consumeDecoratorCanonicalApiIds: semantic.consumeDecoratorCanonicalApiIds,
        eventDecoratorCanonicalApiIds: semantic.eventDecoratorCanonicalApiIds,
    });
}

function compileHandoffEffectSemantic(spec: InternalModuleLoweringIR, semantic: ModuleHandoffEffectSemantic): TaintModule {
    const moduleId = `${spec.id}::${semantic.id}`;
    return defineModule({
        id: moduleId,
        description: `${spec.description} [${semantic.id}]`,
        enabled: spec.enabled,
        setup(ctx) {
            const effects: HandoffEffect[] = [];
            let scannedCalls = 0;
            let unresolvedHandles = 0;
            let unresolvedEndpoints = 0;
            const unresolvedEndpointDetails: unknown[] = [];

            for (const declared of semantic.effects || []) {
                for (const call of scanHandoffSurface(ctx.scan, declared.surface)) {
                    scannedCalls++;
                    const handles = resolveHandoffHandles(ctx.analysis, call, declared.handle);
                    if (handles.length === 0) {
                        unresolvedHandles++;
                        continue;
                    }
                    if (declared.effectKind === "put") {
                        const sourceRefs = declared.value
                            ? resolveEndpointSourceRefs(ctx.analysis, call, declared.value, spec.id, declared.id, declared.effectKind)
                            : [];
                        if (sourceRefs.length === 0) {
                            unresolvedEndpoints++;
                            unresolvedEndpointDetails.push(describeUnresolvedEndpoint(ctx.analysis, call, spec.id, declared.id, declared.effectKind, declared.value));
                            continue;
                        }
                        for (const handle of handles) {
                            for (const source of sourceRefs) {
                                pushModuleHandoffPutEffect(effects, {
                                    call,
                                    handle,
                                    source,
                                    endpoint: declared.value!,
                                    reason: declared.id,
                                    originModel: moduleId,
                                    updateStrength: declared.updateStrength,
                                    confidence: declared.confidence,
                                });
                            }
                        }
                        continue;
                    }
                    if (declared.effectKind === "get") {
                        const targets = declared.target
                            ? resolveEndpointTargetRefs(ctx.analysis, call, declared.target, spec.id, declared.id, declared.effectKind)
                            : [];
                        if (targets.length === 0) {
                            unresolvedEndpoints++;
                            unresolvedEndpointDetails.push(describeUnresolvedEndpoint(ctx.analysis, call, spec.id, declared.id, declared.effectKind, declared.target));
                            continue;
                        }
                        for (const handle of handles) {
                            for (const target of targets) {
                                effects.push({
                                    kind: "get",
                                    handle,
                                    target,
                                    reason: declared.id,
                                    originModel: moduleId,
                                    updateStrength: "strong",
                                    handlePrecision: handle.precision,
                                    confidence: declared.confidence || "likely",
                                    ...handoffInvokeEffectMeta(call, 0),
                                });
                            }
                        }
                        continue;
                    }
                    for (const handle of handles) {
                        effects.push({
                            kind: "kill",
                            handle,
                            reason: declared.id,
                            originModel: moduleId,
                            updateStrength: declared.updateStrength === "weak" ? "weak" : "strong",
                            handlePrecision: handle.precision,
                            confidence: declared.confidence || "likely",
                            ...handoffInvokeEffectMeta(call, 0),
                        });
                    }
                }
            }

            ctx.debug.summary("ModuleHandoffEffect", {
                scanned_calls: scannedCalls,
                effects: effects.length,
                unresolved_handles: unresolvedHandles,
                unresolved_endpoints: unresolvedEndpoints,
                unresolved_endpoint_details: unresolvedEndpointDetails.length > 0
                    ? JSON.stringify(unresolvedEndpointDetails.slice(0, 8))
                    : undefined,
                put_sources: summarizeHandoffPutSources(effects),
                get_targets: summarizeHandoffGetTargets(effects),
            }, { omitEmpty: true });

            const handoff = createHandoffPropagationSession(effects, {
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

function scanHandoffSurface(
    scan: { invokes(filter?: any): ModuleScannedInvoke[]; constructs(filter?: any): ModuleScannedInvoke[] },
    surface: ModuleCallSurfaceSelector,
): ModuleScannedInvoke[] {
    const canonicalApiIds = canonicalApiIdsForSurface(surface);
    if (canonicalApiIds.length === 0) return [];
    if (surface.surfaceKind === "construct") {
        return scan.constructs({ canonicalApiIds });
    }
    return scan.invokes({ canonicalApiIds });
}

function canonicalApiIdsForSurface(surface: ModuleCallSurfaceSelector): string[] {
    const canonicalApiId = String(surface.canonicalApiId || "").trim();
    return canonicalApiId ? [canonicalApiId] : [];
}

function summarizeHandoffPutSources(effects: HandoffEffect[]): string {
    return effects
        .filter((effect): effect is Extract<HandoffEffect, { kind: "put" }> => effect.kind === "put")
        .slice(0, 8)
        .map(effect => `${effect.source.nodeId}:${effect.source.fieldPathPrefix?.join(".") || effect.source.fieldHead || "-"}@${effect.flowScope || "-"}`)
        .join(";");
}

function summarizeHandoffGetTargets(effects: HandoffEffect[]): string {
    return effects
        .filter((effect): effect is Extract<HandoffEffect, { kind: "get" }> => effect.kind === "get")
        .slice(0, 8)
        .map(effect => `${effect.target.nodeId}:${effect.target.fieldPath?.join(".") || "-"}`)
        .join(";");
}

function pushModuleHandoffPutEffect(
    effects: HandoffEffect[],
    args: {
        call: ModuleScannedInvoke;
        handle: HandoffHandle;
        source: ResolvedEndpointSourceRef;
        endpoint: AssetEndpoint;
        reason: string;
        originModel: string;
        updateStrength?: "strong" | "weak";
        confidence?: "certain" | "likely" | "unknown";
    },
): void {
    const source = {
        nodeId: args.source.nodeId,
        ...(args.source.fieldPathPrefix && args.source.fieldPathPrefix.length > 0
            ? { fieldPathPrefix: [...args.source.fieldPathPrefix] }
            : {}),
    };
    if (args.updateStrength === "weak") {
        effects.push({
            kind: "put",
            handle: args.handle,
            source,
            reason: args.reason,
            originModel: args.originModel,
            updateStrength: "weak",
            handlePrecision: args.handle.precision,
            confidence: args.confidence || "likely",
            ...handoffInvokeEffectMeta(args.call, 1),
        });
        return;
    }
    pushHandoffKillThenPut(effects, {
        handle: args.handle,
        source,
        reason: args.reason,
        originModel: args.originModel,
        call: args.call,
    });
}

function resolveHandoffHandles(
    analysis: { stringCandidates(value: any, maxDepth?: number): string[] },
    call: ModuleScannedInvoke,
    template: HandoffHandleTemplate,
): HandoffHandle[] {
    const key = resolveHandleParts(analysis, call, template.key);
    const scope = resolveHandleParts(analysis, call, template.scope || []);
    const owner = resolveHandleParts(analysis, call, template.owner || []);
    const precision = resolveHandlePrecision(template, key.exact && scope.exact && owner.exact);
    if (key.values.length === 0 || !key.exact || !scope.exact || !owner.exact || !precision) return [];
    const out: HandoffHandle[] = [];
    for (const keyValue of key.values) {
        for (const scopeValue of scope.values.length > 0 ? scope.values : [""]) {
            for (const ownerValue of owner.values.length > 0 ? owner.values : [""]) {
                out.push(createHandoffHandle(template.cellKind, template.family, keyValue, {
                    scope: scopeValue,
                    precision,
                    owner: ownerValue || undefined,
                    index: template.index,
                }));
            }
        }
    }
    return out;
}

function resolveHandleParts(
    analysis: { stringCandidates(value: any, maxDepth?: number): string[] },
    call: ModuleScannedInvoke,
    parts: HandleKeyPartTemplate[],
): { values: string[]; exact: boolean } {
    if (parts.length === 0) return { values: [], exact: true };
    let exact = true;
    let combinations: string[][] = [[]];
    for (const part of parts) {
        const resolved = resolveHandlePart(analysis, call, part);
        if (!resolved.exact) exact = false;
        if (resolved.values.length === 0) {
            return { values: [], exact: false };
        }
        combinations = productAppend(combinations, resolved.values);
    }
    return {
        values: combinations.map(encodeHandleParts),
        exact,
    };
}

function resolveHandlePart(
    analysis: { stringCandidates(value: any, maxDepth?: number): string[] },
    call: ModuleScannedInvoke,
    part: HandleKeyPartTemplate,
): { values: string[]; exact: boolean } {
    if (part.kind === "const") {
        return { values: [part.value], exact: true };
    }
    if (part.kind === "fromLiteralArg") {
        return stringValuesForEndpointValue(analysis, call.arg(part.index));
    }
    if (part.kind === "fromEndpoint" || part.kind === "fromEndpointPath") {
        return stringValuesForEndpointValue(analysis, resolveEndpointValue(call, part.endpoint));
    }
    return { values: [], exact: false };
}

function stringValuesForEndpointValue(
    analysis: { stringCandidates(value: any, maxDepth?: number): string[] },
    value: any,
): { values: string[]; exact: boolean } {
    if (value === undefined || value === null) {
        return { values: [], exact: false };
    }
    const values = [...new Set(analysis.stringCandidates(value).map(item => String(item || "").trim()).filter(Boolean))];
    if (values.length === 0) {
        return { values: [], exact: false };
    }
    return { values, exact: true };
}

function productAppend(current: string[][], values: string[]): string[][] {
    const out: string[][] = [];
    for (const prefix of current) {
        for (const value of values.slice(0, 16)) {
            out.push([...prefix, value]);
            if (out.length >= 64) return out;
        }
    }
    return out;
}

function encodeHandleParts(parts: string[]): string {
    if (parts.length === 0) return "";
    if (parts.length === 1) return parts[0];
    return JSON.stringify(parts);
}

function resolveHandlePrecision(template: HandoffHandleTemplate, exact: boolean): "exact" | undefined {
    if (!exact) return undefined;
    if (!template.precision || template.precision === "exact") return "exact";
    return undefined;
}

function resolveEndpointValue(call: ModuleScannedInvoke, endpoint: AssetEndpoint): any | undefined {
    switch (endpoint.base.kind) {
        case "receiver":
            return call.base();
        case "arg":
            return call.arg(endpoint.base.index);
        case "rest":
            return call.arg(endpoint.base.startIndex);
        case "return":
        case "promiseResult":
        case "constructorResult":
            return call.result();
        default:
            return undefined;
    }
}

interface ResolvedEndpointSourceRef {
    nodeId: number;
    fieldPathPrefix?: string[];
}

interface ResolvedEndpointTargetRef {
    nodeId: number;
    fieldPath?: string[];
    preserveSourceField?: boolean;
}

function projectModuleEndpoint(
    analysis: ModuleAnalysisApi,
    call: ModuleScannedInvoke,
    endpoint: AssetEndpoint,
    effectAssetId: string,
    effectId: string,
    effectKind: string,
): SemanticEndpointProjection | undefined {
    void effectKind;
    const semanticSite = acceptedModuleSemanticEffectSite(call, endpoint, effectAssetId, effectId);
    if (!semanticSite) return undefined;
    return analysis.projectEndpoint({
        semanticSite,
        endpointSpec: endpoint,
        stmt: call.stmt,
        invokeExpr: call.invokeExpr,
        allowNodeCreation: false,
        consumer: "module",
    });
}

function acceptedModuleSemanticEffectSite(
    call: ModuleScannedInvoke,
    endpoint: AssetEndpoint,
    effectAssetId: string,
    effectId: string,
): SemanticEffectSite | undefined {
    const endpointPath = formatSemanticEndpointPath(endpoint, call.invokeExpr);
    const matches = call.call.semanticEffectSites.filter(site =>
        site.capability === "module"
        && site.canonicalApiId === call.call.canonicalApiId
        && site.occurrenceId === call.call.occurrenceId
        && site.rawOccurrenceId === call.call.rawOccurrenceId
        && site.effectAssetId === effectAssetId
        && site.effectTemplateId === effectId
        && formatSemanticEndpointPath(site.endpointSpec, call.invokeExpr) === endpointPath
    );
    return matches.length === 1 ? matches[0] : undefined;
}

function resolveEndpointSourceRefs(
    analysis: ModuleAnalysisApi,
    call: ModuleScannedInvoke,
    endpoint: AssetEndpoint,
    effectAssetId: string,
    effectId: string,
    effectKind: string,
): ResolvedEndpointSourceRef[] {
    const projection = projectModuleEndpoint(analysis, call, endpoint, effectAssetId, effectId, effectKind);
    if (!projection || projection.status !== "resolved") return [];
    const out = new Map<string, ResolvedEndpointSourceRef>();
    const add = (nodeId: number, fieldPathPrefix?: string[]): void => {
        const prefix = fieldPathPrefix && fieldPathPrefix.length > 0 ? [...fieldPathPrefix] : undefined;
        const key = `${nodeId}#${prefix?.join(".") || ""}`;
        if (out.has(key)) return;
        out.set(key, { nodeId, ...(prefix ? { fieldPathPrefix: prefix } : {}) });
    };
    const fieldPath = projection.fieldPath && projection.fieldPath.length > 0
        ? [...projection.fieldPath]
        : undefined;
    if (fieldPath) {
        for (const nodeId of projection.carrierNodeIds) add(nodeId, fieldPath);
        return [...out.values()];
    }
    for (const nodeId of projection.nodeIds) add(nodeId);
    for (const nodeId of projection.carrierNodeIds) add(nodeId);
    return [...out.values()];
}

function resolveEndpointTargetRefs(
    analysis: ModuleAnalysisApi,
    call: ModuleScannedInvoke,
    endpoint: AssetEndpoint,
    effectAssetId: string,
    effectId: string,
    effectKind: string,
): ResolvedEndpointTargetRef[] {
    const projection = projectModuleEndpoint(analysis, call, endpoint, effectAssetId, effectId, effectKind);
    if (!projection || projection.status !== "resolved") return [];
    const out = new Map<string, ResolvedEndpointTargetRef>();
    const fieldPath = projection.fieldPath && projection.fieldPath.length > 0
        ? [...projection.fieldPath]
        : undefined;
    const add = (nodeId: number): void => {
        const key = `${nodeId}#${fieldPath?.join(".") || ""}`;
        if (out.has(key)) return;
        out.set(key, fieldPath
            ? { nodeId, fieldPath: [...fieldPath], preserveSourceField: false }
            : { nodeId });
    };
    if (fieldPath) {
        for (const nodeId of projection.carrierNodeIds) add(nodeId);
    } else {
        for (const nodeId of projection.nodeIds) add(nodeId);
        for (const nodeId of projection.carrierNodeIds) add(nodeId);
    }
    return [...out.values()];
}

function describeUnresolvedEndpoint(
    analysis: ModuleAnalysisApi,
    call: ModuleScannedInvoke,
    effectAssetId: string,
    effectId: string,
    effectKind: string,
    endpoint: AssetEndpoint | undefined,
): unknown {
    if (!endpoint) {
        return {
            effectId,
            effectKind,
            call: call.call.signature,
            owner: call.ownerMethodSignature,
            reason: "missing-endpoint",
        };
    }
    const projection = projectModuleEndpoint(analysis, call, endpoint, effectAssetId, effectId, effectKind);
    if (!projection) {
        return {
            effectId,
            effectKind,
            call: call.call.signature,
            owner: call.ownerMethodSignature,
            stmt: String(call.stmt?.toString?.() || ""),
            endpoint,
            reason: "accepted-module-semantic-site-not-found",
        };
    }
    return {
        effectId,
        effectKind,
        call: call.call.signature,
        owner: call.ownerMethodSignature,
        stmt: String(call.stmt?.toString?.() || ""),
        endpoint,
        projection: projection.record,
    };
}

export function compileRuntimeSemanticModule(
    spec: InternalModuleLoweringIR,
    semantic: ModuleSemantic & { id: string },
): TaintModule | undefined {
    switch (semantic.kind) {
        case "container":
            return compileContainerSemantic(spec, semantic);
        case "ability_handoff":
            return compileAbilityHandoffSemantic(spec, semantic);
        case "keyed_storage":
            return compileKeyedStorageSemantic(spec, semantic);
        case "event_emitter":
            return compileEventEmitterSemantic(spec, semantic);
        case "route_bridge":
            return compileRouteBridgeSemantic(spec, semantic);
        case "state_binding":
            return compileStateBindingSemantic(spec, semantic);
        case "handoff_effect":
            return compileHandoffEffectSemantic(spec, semantic);
        default:
            return undefined;
    }
}
