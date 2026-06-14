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
import type { ModuleScannedInvoke, TaintModule } from "../../kernel/contracts/ModuleContract";
import type { AssetEndpoint, HandoffHandleTemplate, HandleKeyPartTemplate } from "../../assets/schema";
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
    });
}

function compileAbilityHandoffSemantic(spec: InternalModuleLoweringIR, semantic: ModuleAbilityHandoffSemantic): TaintModule {
    return createHarmonyAbilityHandoffSemanticModule({
        id: `${spec.id}::${semantic.id}`,
        description: `${spec.description} [${semantic.id}]`,
        startMethods: semantic.startMethods,
        targetMethods: semantic.targetMethods,
    });
}

function compileEventEmitterSemantic(spec: InternalModuleLoweringIR, semantic: ModuleEventEmitterSemantic): TaintModule {
    return createHarmonyEventEmitterSemanticModule({
        id: `${spec.id}::${semantic.id}`,
        description: `${spec.description} [${semantic.id}]`,
        onMethods: semantic.onMethods,
        emitMethods: semantic.emitMethods,
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
        storageClasses: semantic.storageClasses,
        writeMethods: semantic.writeMethods,
        readMethods: semantic.readMethods,
        killMethods: semantic.killMethods,
        propDecorators: semantic.propDecorators,
        linkDecorators: semantic.linkDecorators,
    });
}

function compileRouteBridgeSemantic(spec: InternalModuleLoweringIR, semantic: ModuleRouteBridgeSemantic): TaintModule {
    return createHarmonyRouteBridgeSemanticModule({
        id: `${spec.id}::${semantic.id}`,
        description: `${spec.description} [${semantic.id}]`,
        pushMethods: semantic.pushMethods,
        getMethods: semantic.getMethods,
        routerClassNames: semantic.routerClassNames,
        navDestinationClassNames: semantic.navDestinationClassNames,
        navDestinationRegisterMethods: semantic.navDestinationRegisterMethods,
        frameworkSignatureHints: semantic.frameworkSignatureHints,
        payloadUnwrapPrefixes: semantic.payloadUnwrapPrefixes,
    });
}

function compileStateBindingSemantic(spec: InternalModuleLoweringIR, semantic: ModuleStateBindingSemantic): TaintModule {
    return createHarmonyStateBindingSemanticModule({
        id: `${spec.id}::${semantic.id}`,
        description: `${spec.description} [${semantic.id}]`,
        stateDecorators: semantic.stateDecorators,
        propDecorators: semantic.propDecorators,
        linkDecorators: semantic.linkDecorators,
        provideDecorators: semantic.provideDecorators,
        consumeDecorators: semantic.consumeDecorators,
        eventDecorators: semantic.eventDecorators,
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

            for (const declared of semantic.effects || []) {
                for (const call of scanHandoffSurface(ctx.scan, declared.surface)) {
                    scannedCalls++;
                    const handles = resolveHandoffHandles(ctx.analysis, call, declared.handle);
                    if (handles.length === 0) {
                        unresolvedHandles++;
                        continue;
                    }
                    if (declared.effectKind === "put") {
                        const sourceRefs = declared.value ? resolveEndpointSourceRefs(call, declared.value) : [];
                        if (sourceRefs.length === 0) {
                            unresolvedEndpoints++;
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
                        const targetNodeIds = declared.target ? resolveEndpointTargetNodeIds(call, declared.target) : [];
                        if (targetNodeIds.length === 0) {
                            unresolvedEndpoints++;
                            continue;
                        }
                        for (const handle of handles) {
                            for (const nodeId of targetNodeIds) {
                                effects.push({
                                    kind: "get",
                                    handle,
                                    target: targetEndpoint(nodeId, declared.target!),
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
                put_sources: summarizeHandoffPutSources(effects),
                get_targets: summarizeHandoffGetTargets(effects),
            }, { omitEmpty: true });

            const handoff = createHandoffPropagationSession(effects);
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
    if (surface.surfaceKind === "construct") {
        return scan.constructs({ ...surface });
    }
    return scan.invokes({ ...surface });
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
        updateStrength?: "strong" | "weak" | "infer";
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
    if (key.values.length === 0) return [];
    const out: HandoffHandle[] = [];
    for (const keyValue of key.values) {
        for (const scopeValue of scope.values.length > 0 ? scope.values : [""]) {
            for (const ownerValue of owner.values.length > 0 ? owner.values : [""]) {
                out.push(createHandoffHandle(template.cellKind, template.family, keyValue, {
                    scope: scopeValue,
                    precision: resolveHandlePrecision(template, key.exact && scope.exact && owner.exact),
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
        combinations = productAppend(combinations, resolved.values.length > 0 ? resolved.values : ["__UNKNOWN__"]);
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
    return { values: ["__UNKNOWN__"], exact: false };
}

function stringValuesForEndpointValue(
    analysis: { stringCandidates(value: any, maxDepth?: number): string[] },
    value: any,
): { values: string[]; exact: boolean } {
    if (value === undefined || value === null) {
        return { values: ["__UNKNOWN__"], exact: false };
    }
    const values = [...new Set(analysis.stringCandidates(value).map(item => String(item || "").trim()).filter(Boolean))];
    if (values.length === 0) {
        const raw = String(value?.toString?.() || "").trim();
        return raw ? { values: [raw], exact: false } : { values: ["__UNKNOWN__"], exact: false };
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

function resolveHandlePrecision(template: HandoffHandleTemplate, exact: boolean): "exact" | "partial" | "unknown" {
    if (template.precision === "exact") return "exact";
    if (template.precision === "partial") return "partial";
    if (template.precision === "unknown") return "unknown";
    return exact ? "exact" : "unknown";
}

function resolveEndpointValue(call: ModuleScannedInvoke, endpoint: AssetEndpoint): any | undefined {
    switch (endpoint.base.kind) {
        case "receiver":
            return call.base();
        case "arg":
            return call.arg(endpoint.base.index);
        case "return":
        case "promiseResult":
        case "constructorResult":
            return call.result();
        default:
            return undefined;
    }
}

function resolveEndpointNodeIds(call: ModuleScannedInvoke, endpoint: AssetEndpoint): number[] {
    switch (endpoint.base.kind) {
        case "receiver":
            return call.baseNodeIds();
        case "arg":
            return call.argNodeIds(endpoint.base.index);
        case "return":
        case "promiseResult":
        case "constructorResult":
            return call.resultNodeIds();
        case "callbackArg":
            if (endpoint.base.callback.kind !== "arg") return [];
            return call.callbackParamNodeIds(endpoint.base.callback.index, endpoint.base.argIndex);
        default:
            return [];
    }
}

interface ResolvedEndpointSourceRef {
    nodeId: number;
    fieldPathPrefix?: string[];
}

function resolveEndpointSourceRefs(call: ModuleScannedInvoke, endpoint: AssetEndpoint): ResolvedEndpointSourceRef[] {
    const out = new Map<string, ResolvedEndpointSourceRef>();
    const add = (nodeId: number, fieldPathPrefix?: string[]): void => {
        const prefix = fieldPathPrefix && fieldPathPrefix.length > 0 ? [...fieldPathPrefix] : undefined;
        const key = `${nodeId}#${prefix?.join(".") || ""}`;
        if (out.has(key)) return;
        out.set(key, { nodeId, ...(prefix ? { fieldPathPrefix: prefix } : {}) });
    };
    const endpointPrefix = endpoint.accessPath && endpoint.accessPath.length > 0
        ? [...endpoint.accessPath]
        : undefined;
    for (const nodeId of resolveEndpointNodeIds(call, endpoint)) {
        add(nodeId, endpointPrefix);
    }
    switch (endpoint.base.kind) {
        case "receiver":
            for (const nodeId of call.baseCarrierNodeIds()) add(nodeId, endpointPrefix);
            for (const nodeId of call.baseObjectNodeIds()) add(nodeId, endpointPrefix);
            if (endpoint.accessPath && endpoint.accessPath.length > 0) {
                for (const nodeId of call.calleeReceiverEndpointNodeIds?.(endpoint.accessPath) || []) {
                    add(nodeId);
                }
            }
            break;
        case "arg":
            for (const nodeId of call.argCarrierNodeIds(endpoint.base.index)) add(nodeId, endpointPrefix);
            for (const nodeId of call.argObjectNodeIds(endpoint.base.index)) add(nodeId, endpointPrefix);
            break;
        case "return":
        case "promiseResult":
        case "constructorResult":
            for (const nodeId of call.resultCarrierNodeIds()) add(nodeId, endpointPrefix);
            break;
    }
    return [...out.values()];
}

function resolveEndpointTargetNodeIds(call: ModuleScannedInvoke, endpoint: AssetEndpoint): number[] {
    const out = new Set<number>(resolveEndpointNodeIds(call, endpoint));
    switch (endpoint.base.kind) {
        case "receiver":
            for (const nodeId of call.baseCarrierNodeIds()) out.add(nodeId);
            break;
        case "arg":
            for (const nodeId of call.argCarrierNodeIds(endpoint.base.index)) out.add(nodeId);
            break;
        case "return":
        case "promiseResult":
        case "constructorResult":
            for (const nodeId of call.resultCarrierNodeIds()) out.add(nodeId);
            break;
    }
    return [...out.values()];
}

function targetEndpoint(nodeId: number, endpoint: AssetEndpoint) {
    if (endpoint.accessPath && endpoint.accessPath.length > 0) {
        return {
            nodeId,
            fieldPath: [...endpoint.accessPath],
            preserveSourceField: false,
        };
    }
    return { nodeId };
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
