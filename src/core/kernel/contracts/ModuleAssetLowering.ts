import type {
    AnalysisAssetLoadMode,
    AssetDocumentBase,
    AssetEndpoint,
    AssetSurface,
    CoreCapabilityTemplate,
    ConstructSurface,
    HandoffGetTemplate,
    HandoffKillTemplate,
    HandoffPutTemplate,
    InvokeSurface,
    ModuleEventEmitterTemplate,
    SemanticEffectTemplate,
} from "../../assets/schema";
import { isAnalysisLoadableAssetStatus, validateAssetDocument } from "../../assets/schema";
import type {
    ModuleAbilityHandoffSemantic,
    ModuleBridgeSemantic,
    ModuleContainerSemantic,
    ModuleEventEmitterSemantic,
    ModuleHandoffEffectSemantic,
    ModuleKeyedStorageSemantic,
    ModuleRouteBridgeSemantic,
    ModuleSemantic,
    InternalModuleLoweringIR,
    ModuleStateBindingSemantic,
} from "./InternalModuleLoweringIR";

export function isModuleAsset(value: unknown): value is AssetDocumentBase {
    return !!value
        && typeof value === "object"
        && !Array.isArray(value)
        && (value as any).plane === "module"
        && Array.isArray((value as any).surfaces)
        && Array.isArray((value as any).bindings);
}

export function lowerModuleAssetToInternalModuleLoweringIR(
    asset: AssetDocumentBase,
    options: { loadMode?: AnalysisAssetLoadMode } = {},
): InternalModuleLoweringIR {
    const validation = validateAssetDocument(asset);
    if (!validation.valid) {
        throw new Error(`invalid module asset ${asset.id || "<unknown>"}: ${validation.errors.join("; ")}`);
    }
    if (!isAnalysisStatus(asset.status, options.loadMode)) {
        throw new Error(`module asset ${asset.id} is not loadable with status ${asset.status}`);
    }
    const hasCoreCapability = (asset.effectTemplates || []).some(template => template.kind === "core.capability");
    if (!isAllowedModuleProvenance(asset.provenance.source, hasCoreCapability)) {
        const provenanceKind = hasCoreCapability ? "core capabilities" : "module semantics";
        throw new Error(`module asset ${asset.id} uses ${provenanceKind} from disallowed provenance ${asset.provenance.source}`);
    }
    const semantics = lowerModuleSemantics(asset);
    if (semantics.length === 0) {
        throw new Error(`module asset ${asset.id} declares no loadable module capability templates`);
    }
    return {
        id: asset.id,
        description: descriptionFromAsset(asset),
        enabled: asset.status !== "deprecated" && asset.status !== "rejected",
        semantics,
    };
}

export function lowerModuleAssetsToInternalModuleLoweringIRs(
    assets: AssetDocumentBase[],
    options: { loadMode?: AnalysisAssetLoadMode } = {},
): InternalModuleLoweringIR[] {
    return assets.map(asset => lowerModuleAssetToInternalModuleLoweringIR(asset, options));
}

function isAnalysisStatus(
    status: AssetDocumentBase["status"],
    loadMode: AnalysisAssetLoadMode = "trusted-analysis",
): boolean {
    return isAnalysisLoadableAssetStatus(status, loadMode);
}

function isAllowedModuleProvenance(
    source: AssetDocumentBase["provenance"]["source"],
    hasCoreCapability: boolean,
): boolean {
    if (hasCoreCapability) {
        return source === "builtin" || source === "manual" || source === "sdk";
    }
    if (source === "builtin" || source === "manual" || source === "sdk" || source === "project" || source === "llm") {
        return true;
    }
    return false;
}

function lowerModuleSemantics(asset: AssetDocumentBase): Array<ModuleSemantic & { id: string }> {
    const templates = asset.effectTemplates || [];
    const coreSemantics = templates
        .filter((template): template is CoreCapabilityTemplate => template.kind === "core.capability")
        .map(template => lowerCoreCapabilityTemplate(asset, template));
    const moduleEventEmitterSemantics = templates
        .filter((template): template is ModuleEventEmitterTemplate => template.kind === "module.eventEmitter")
        .map(template => moduleEventEmitterSemantic(template, asset));
    const handoffEffectSemantics = lowerHandoffTemplatesToEffectSemantics(asset);
    return [...coreSemantics, ...moduleEventEmitterSemantics, ...handoffEffectSemantics];
}

function lowerModuleEffectTemplate(asset: AssetDocumentBase, template: SemanticEffectTemplate): ModuleSemantic & { id: string } {
    if (template.kind !== "core.capability") {
        throw new Error(`module asset ${asset.id} contains non-core module template ${template.kind}`);
    }
    return lowerCoreCapabilityTemplate(asset, template);
}

function lowerHandoffTemplatesToEffectSemantics(asset: AssetDocumentBase): Array<(ModuleHandoffEffectSemantic | ModuleKeyedStorageSemantic) & { id: string }> {
    const templates = new Map((asset.effectTemplates || []).map(template => [template.id, template]));
    const effects: ModuleHandoffEffectSemantic["effects"] = [];

    for (const binding of asset.bindings || []) {
        if (binding.role !== "handoff" || binding.plane !== "module") continue;
        const surface = findHandoffSurface(asset, binding.surfaceId);
        if (!surface) continue;
        const selector = surfaceToModuleSelector(surface);
        for (const ref of binding.effectTemplateRefs || []) {
            const template = templates.get(ref);
            if (!template) continue;
            assertExactHandoffTemplate(asset, template, binding.bindingId);
            if (template.kind === "handoff.put") {
                effects.push({
                    id: template.id,
                    effectKind: "put",
                    surface: selector,
                    handle: (template as HandoffPutTemplate).handle,
                    value: (template as HandoffPutTemplate).value,
                    updateStrength: (template as HandoffPutTemplate).updateStrength,
                    confidence: (template as HandoffPutTemplate).confidence || binding.confidence,
                });
                continue;
            }
            if (template.kind === "handoff.get") {
                effects.push({
                    id: template.id,
                    effectKind: "get",
                    surface: selector,
                    handle: (template as HandoffGetTemplate).handle,
                    target: (template as HandoffGetTemplate).target,
                    confidence: (template as HandoffGetTemplate).confidence || binding.confidence,
                });
                continue;
            }
            if (template.kind === "handoff.kill") {
                effects.push({
                    id: template.id,
                    effectKind: "kill",
                    surface: selector,
                    handle: (template as HandoffKillTemplate).handle,
                    updateStrength: (template as HandoffKillTemplate).updateStrength,
                    confidence: (template as HandoffKillTemplate).confidence || binding.confidence,
                });
            }
        }
    }

    if (effects.length === 0) return [];
    const keyedStorage = tryLowerHandoffEffectsToKeyedStorage(asset.id, effects);
    if (keyedStorage) {
        return [keyedStorage];
    }
    return [{
        id: `${asset.id}.handoff.effects`,
        kind: "handoff_effect",
        effects,
    }];
}

function assertExactHandoffTemplate(asset: AssetDocumentBase, template: SemanticEffectTemplate, bindingId: string): void {
    if (template.kind !== "handoff.put" && template.kind !== "handoff.get" && template.kind !== "handoff.kill") {
        return;
    }
    const precision = (template as HandoffPutTemplate | HandoffGetTemplate | HandoffKillTemplate).handle?.precision;
    if (precision !== "exact") {
        throw new Error(
            `module asset ${asset.id} binding ${bindingId} template ${template.id} uses non-exact handoff precision ${String(precision)}`,
        );
    }
    if ((template.kind === "handoff.put" || template.kind === "handoff.kill")
        && (template as any).updateStrength === "infer") {
        throw new Error(
            `module asset ${asset.id} binding ${bindingId} template ${template.id} uses infer handoff updateStrength`,
        );
    }
}

function tryLowerHandoffEffectsToKeyedStorage(
    assetId: string,
    effects: ModuleHandoffEffectSemantic["effects"],
): (ModuleKeyedStorageSemantic & { id: string }) | undefined {
    if (effects.length === 0) {
        return undefined;
    }
    const writeApis: ModuleKeyedStorageSemantic["writeApis"] = [];
    const readCanonicalApiIds = new Set<string>();
    const killCanonicalApiIds = new Set<string>();
    let expectedHandleKey: string | undefined;

    for (const effect of effects) {
        const canonicalApiId = effect.surface.surfaceKind === "construct"
            ? effect.surface.canonicalApiId
            : effect.surface.canonicalApiId;
        if (!canonicalApiId) {
            return undefined;
        }
        const handleKey = canonicalKeyedStorageHandleTemplate(effect.handle);
        if (!handleKey) {
            return undefined;
        }
        if (expectedHandleKey === undefined) {
            expectedHandleKey = handleKey;
        } else if (expectedHandleKey !== handleKey) {
            return undefined;
        }
        if (effect.effectKind === "put") {
            const valueIndex = endpointArgIndex(effect.value);
            if (valueIndex === undefined) {
                return undefined;
            }
            writeApis.push({
                canonicalApiIds: [canonicalApiId],
                valueIndex,
                ...(effect.updateStrength ? { updateStrength: effect.updateStrength } : {}),
            });
            continue;
        }
        if (effect.effectKind === "get") {
            readCanonicalApiIds.add(canonicalApiId);
            continue;
        }
        if (effect.effectKind === "kill") {
            killCanonicalApiIds.add(canonicalApiId);
        }
    }

    if (writeApis.length === 0 || readCanonicalApiIds.size === 0) {
        return undefined;
    }
    return {
        id: `${assetId}.keyed_storage`,
        kind: "keyed_storage",
        writeApis: dedupeWriteApis(writeApis),
        readCanonicalApiIds: [...readCanonicalApiIds].sort(),
        ...(killCanonicalApiIds.size > 0 ? { killCanonicalApiIds: [...killCanonicalApiIds].sort() } : {}),
    };
}

function canonicalKeyedStorageHandleTemplate(handle: HandoffPutTemplate["handle"]): string | undefined {
    if (!handle?.cellKind || !handle.family || !Array.isArray(handle.key) || handle.key.length === 0) {
        return undefined;
    }
    if (handle.cellKind !== "keyed-semantic-slot") {
        return undefined;
    }
    const key = handle.key.map(part => JSON.stringify(part)).join("|");
    const scope = (handle.scope || []).map(part => JSON.stringify(part)).join("|");
    const owner = (handle.owner || []).map(part => JSON.stringify(part)).join("|");
    return JSON.stringify({
        cellKind: handle.cellKind,
        family: handle.family,
        key,
        scope,
        owner,
        index: handle.index,
    });
}

function endpointArgIndex(endpoint: unknown): number | undefined {
    const base = (endpoint as any)?.base;
    return base?.kind === "arg" && Number.isInteger(base.index) ? base.index : undefined;
}

function dedupeWriteApis(
    apis: ModuleKeyedStorageSemantic["writeApis"],
): ModuleKeyedStorageSemantic["writeApis"] {
    const byKey = new Map<string, ModuleKeyedStorageSemantic["writeApis"][number]>();
    for (const api of apis) {
        const canonicalApiIds = [...new Set(api.canonicalApiIds)].sort();
        byKey.set(`${canonicalApiIds.join(",")}#${api.valueIndex}#${api.updateStrength || ""}`, {
            canonicalApiIds,
            valueIndex: api.valueIndex,
            ...(api.updateStrength ? { updateStrength: api.updateStrength } : {}),
        });
    }
    return [...byKey.values()].sort((left, right) =>
        left.canonicalApiIds.join(",").localeCompare(right.canonicalApiIds.join(","))
        || left.valueIndex - right.valueIndex
        || String(left.updateStrength || "").localeCompare(String(right.updateStrength || "")),
    );
}

type HandoffSurface = InvokeSurface | ConstructSurface;

function findHandoffSurface(asset: AssetDocumentBase, surfaceId: string): HandoffSurface | undefined {
    const surface = (asset.surfaces || []).find(item => item.surfaceId === surfaceId);
    return surface?.kind === "invoke" || surface?.kind === "construct" ? surface : undefined;
}

function surfaceToModuleSelector(surface: HandoffSurface) {
    if (surface.kind === "construct") {
        return constructSurfaceToModuleSelector(surface);
    }
    return invokeSurfaceToModuleSelector(surface);
}

function invokeSurfaceToModuleSelector(surface: InvokeSurface) {
    return {
        surfaceKind: "invoke" as const,
        canonicalApiId: requireCanonicalSurfaceId(surface),
    };
}

function constructSurfaceToModuleSelector(surface: ConstructSurface) {
    return {
        surfaceKind: "construct" as const,
        canonicalApiId: requireCanonicalSurfaceId(surface),
    };
}

function requireCanonicalSurfaceId(surface: InvokeSurface | ConstructSurface): string {
    const canonicalApiId = String(surface.canonicalApiId || "").trim();
    if (!canonicalApiId) {
        throw new Error(`module surface ${surface.surfaceId} must declare canonicalApiId`);
    }
    return canonicalApiId;
}

function lowerCoreCapabilityTemplate(asset: AssetDocumentBase, template: CoreCapabilityTemplate): ModuleSemantic & { id: string } {
    switch (template.capability) {
        case "module.container":
            return moduleContainerSemantic(template);
        case "module.ability-handoff":
            return moduleAbilityHandoffSemantic(template);
        case "module.keyed-storage":
            return moduleKeyedStorageSemantic(template, asset);
        case "module.event-emitter":
            return moduleEventEmitterSemantic(template, asset);
        case "module.route-bridge":
            return moduleRouteBridgeSemantic(asset, template);
        case "module.state-binding":
            return moduleStateBindingSemantic(template);
        case "module.bridge":
            return moduleBridgeSemantic(asset, template);
        default:
            throw new Error(`module asset ${asset.id} declares unsupported core capability ${template.capability}`);
    }
}

function moduleContainerSemantic(template: CoreCapabilityTemplate): ModuleContainerSemantic & { id: string } {
    const families = optionalStringArray(template.payload.families) as ModuleContainerSemantic["families"] | undefined;
    const capabilities = optionalStringArray(template.payload.capabilities) as ModuleContainerSemantic["capabilities"] | undefined;
    return {
        id: template.id,
        kind: "container",
        ...(families ? { families } : {}),
        ...(capabilities ? { capabilities } : {}),
        mutationCanonicalApiIds: stringArray(template.payload.mutationCanonicalApiIds),
        accessCanonicalApiIds: stringArray(template.payload.accessCanonicalApiIds),
    };
}

function moduleAbilityHandoffSemantic(template: CoreCapabilityTemplate): ModuleAbilityHandoffSemantic & { id: string } {
    return {
        id: template.id,
        kind: "ability_handoff",
        startCanonicalApiIds: stringArray(template.payload.startCanonicalApiIds),
        targetCanonicalApiIds: stringArray(template.payload.targetCanonicalApiIds),
    };
}

function moduleKeyedStorageSemantic(template: CoreCapabilityTemplate, asset: AssetDocumentBase): ModuleKeyedStorageSemantic & { id: string } {
    return {
        id: template.id,
        kind: "keyed_storage",
        writeApis: keyedStorageWriteApis(template.payload.writeApis),
        writeResultApis: keyedStorageWriteApis(template.payload.writeResultApis),
        readCanonicalApiIds: stringArray(template.payload.readCanonicalApiIds),
        killCanonicalApiIds: optionalStringArray(template.payload.killCanonicalApiIds),
        propDecoratorCanonicalApiIds: optionalStringArray(template.payload.propDecoratorCanonicalApiIds),
        linkDecoratorCanonicalApiIds: optionalStringArray(template.payload.linkDecoratorCanonicalApiIds),
    };
}

function keyedStorageWriteApis(value: unknown): ModuleKeyedStorageSemantic["writeApis"] {
    return objectArray(value).map(api => ({
        canonicalApiIds: stringArray((api as any).canonicalApiIds),
        valueIndex: Number((api as any).valueIndex),
        ...(keyedStorageUpdateStrength((api as any).updateStrength)
            ? { updateStrength: keyedStorageUpdateStrength((api as any).updateStrength) }
            : {}),
    }));
}

function keyedStorageUpdateStrength(value: unknown): "strong" | "weak" | undefined {
    return value === "strong" || value === "weak" ? value : undefined;
}

function moduleEventEmitterSemantic(template: CoreCapabilityTemplate | ModuleEventEmitterTemplate, asset: AssetDocumentBase): ModuleEventEmitterSemantic & { id: string } {
    const payload = template.kind === "core.capability" ? template.payload : template;
    return {
        id: template.id,
        kind: "event_emitter",
        onCanonicalApiIds: stringArray(payload.onCanonicalApiIds),
        emitCanonicalApiIds: stringArray(payload.emitCanonicalApiIds),
        channelArgIndexes: optionalNumberArray(payload.channelArgIndexes),
        payloadArgIndex: optionalNumber(payload.payloadArgIndex),
        callbackArgIndex: optionalNumber(payload.callbackArgIndex),
        callbackParamIndex: optionalNumber(payload.callbackParamIndex),
        maxCandidates: optionalNumber(payload.maxCandidates),
    };
}

function moduleRouteBridgeSemantic(asset: AssetDocumentBase, template: CoreCapabilityTemplate): ModuleRouteBridgeSemantic & { id: string } {
    const pushApis = objectArray(template.payload.pushApis) as ModuleRouteBridgeSemantic["pushApis"];
    return {
        id: template.id,
        kind: "route_bridge",
        pushApis: pushApis.map(api => ({
            canonicalApiIds: stringArray((api as any).canonicalApiIds),
            ...((api as any).routeField ? { routeField: String((api as any).routeField) } : {}),
            ...((api as any).routeArgIndex !== undefined ? { routeArgIndex: Number((api as any).routeArgIndex) } : {}),
            ...((api as any).payloadArgIndex !== undefined ? { payloadArgIndex: Number((api as any).payloadArgIndex) } : {}),
            ...((api as any).payloadField ? { payloadField: String((api as any).payloadField) } : {}),
        })),
        getCanonicalApiIds: stringArray(template.payload.getCanonicalApiIds),
        getApis: objectArray(template.payload.getApis).map(api => ({
            canonicalApiIds: stringArray((api as any).canonicalApiIds),
            ...((api as any).routeArgIndex !== undefined ? { routeArgIndex: Number((api as any).routeArgIndex) } : {}),
            ...((api as any).routeField ? { routeField: String((api as any).routeField) } : {}),
        })),
        navDestinationRegisterApis: objectArray(template.payload.navDestinationRegisterApis).map(api => ({
            canonicalApiIds: stringArray((api as any).canonicalApiIds),
            callbackArgIndex: Number((api as any).callbackArgIndex),
            ...((api as any).routeParamIndex !== undefined ? { routeParamIndex: Number((api as any).routeParamIndex) } : {}),
            payloadParamIndex: Number((api as any).payloadParamIndex),
        })),
        navDestinationTriggerApis: objectArray(template.payload.navDestinationTriggerApis).map(api => ({
            canonicalApiIds: stringArray((api as any).canonicalApiIds),
            ...((api as any).routeField ? { routeField: String((api as any).routeField) } : {}),
            ...((api as any).routeArgIndex !== undefined ? { routeArgIndex: Number((api as any).routeArgIndex) } : {}),
            ...((api as any).payloadArgIndex !== undefined ? { payloadArgIndex: Number((api as any).payloadArgIndex) } : {}),
            ...((api as any).payloadField ? { payloadField: String((api as any).payloadField) } : {}),
        })),
        payloadUnwrapPrefixes: optionalStringArray(template.payload.payloadUnwrapPrefixes),
    };
}

function moduleStateBindingSemantic(template: CoreCapabilityTemplate): ModuleStateBindingSemantic & { id: string } {
    return {
        id: template.id,
        kind: "state_binding",
        stateDecoratorCanonicalApiIds: stringArray(template.payload.stateDecoratorCanonicalApiIds),
        propDecoratorCanonicalApiIds: stringArray(template.payload.propDecoratorCanonicalApiIds),
        linkDecoratorCanonicalApiIds: stringArray(template.payload.linkDecoratorCanonicalApiIds),
        provideDecoratorCanonicalApiIds: optionalStringArray(template.payload.provideDecoratorCanonicalApiIds),
        consumeDecoratorCanonicalApiIds: optionalStringArray(template.payload.consumeDecoratorCanonicalApiIds),
        eventDecoratorCanonicalApiIds: optionalStringArray(template.payload.eventDecoratorCanonicalApiIds),
    };
}

function moduleBridgeSemantic(asset: AssetDocumentBase, template: CoreCapabilityTemplate): ModuleBridgeSemantic & { id: string } {
    const bridge = template.payload.bridge;
    if (!bridge || typeof bridge !== "object" || Array.isArray(bridge)) {
        throw new Error(`module bridge capability ${template.id} requires payload.bridge`);
    }
    const normalizedBridge = normalizeModuleBridgePayload(asset, bridge as Record<string, unknown>, template.id);
    const sourceGuard = resolveBridgeSourceGuardEndpoint(asset, template, normalizedBridge);
    return {
        id: template.id,
        kind: "bridge",
        ...(normalizedBridge as Omit<ModuleBridgeSemantic, "id" | "kind">),
        ...(sourceGuard ? { sourceGuard } : {}),
    };
}

function normalizeModuleBridgePayload(
    asset: AssetDocumentBase,
    bridge: Record<string, unknown>,
    templateId: string,
): Record<string, unknown> {
    return {
        ...bridge,
        from: normalizeModuleEndpointSurfaceRef(asset, bridge.from, `${templateId}.bridge.from`),
        to: normalizeModuleEndpointSurfaceRef(asset, bridge.to, `${templateId}.bridge.to`),
        dispatch: normalizeDispatchSurfaceRefs(asset, bridge.dispatch, `${templateId}.bridge.dispatch`),
    };
}

function normalizeDispatchSurfaceRefs(asset: AssetDocumentBase, dispatch: unknown, path: string): unknown {
    if (!dispatch || typeof dispatch !== "object" || Array.isArray(dispatch)) return dispatch;
    const out: Record<string, unknown> = { ...(dispatch as Record<string, unknown>) };
    if (out.via !== undefined) {
        out.via = normalizeModuleEndpointSurfaceRef(asset, out.via, `${path}.via`);
    }
    return out;
}

function normalizeModuleEndpointSurfaceRef(asset: AssetDocumentBase, endpoint: unknown, path: string): unknown {
    if (!endpoint || typeof endpoint !== "object" || Array.isArray(endpoint)) return endpoint;
    const out: Record<string, unknown> = { ...(endpoint as Record<string, unknown>) };
    out.surface = normalizeModuleSurfaceRef(asset, out.surface, `${path}.surface`);
    return out;
}

function normalizeModuleSurfaceRef(asset: AssetDocumentBase, raw: unknown, path: string): unknown {
    if (typeof raw === "string") return raw;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error(`${path} must reference a module asset surface by surfaceId/canonicalApiId`);
    }
    const value = raw as Record<string, unknown>;
    if (value.selector !== undefined) {
        throw new Error(`${path} must not use selector; reference canonical module surface identity`);
    }
    const surface = resolvePayloadSurface(asset, value, path);
    if (surface.kind !== "invoke") {
        throw new Error(`${path} references unsupported module bridge surface kind ${surface.kind}`);
    }
    return {
        kind: "invoke",
        selector: invokeSurfaceToModuleSelector(surface),
    };
}

function resolveBridgeSourceGuardEndpoint(
    asset: AssetDocumentBase,
    template: CoreCapabilityTemplate,
    normalizedBridge: Record<string, unknown>,
): ModuleBridgeSemantic["sourceGuard"] | undefined {
    const from = normalizedBridge.from as ModuleBridgeSemantic["from"] | undefined;
    const surfaceRef = from?.surface;
    if (!surfaceRef || surfaceRef.kind !== "invoke") return undefined;
    const canonicalApiId = surfaceRef.selector.canonicalApiId;
    const bindings = (asset.bindings || []).filter(binding =>
        binding.canonicalApiId === canonicalApiId
        && (binding.effectTemplateRefs || []).includes(template.id)
        && binding.endpoint,
    );
    if (bindings.length === 0) return undefined;
    if (bindings.length !== 1) {
        throw new Error(`module bridge capability ${template.id} source guard must resolve exactly one binding endpoint for ${canonicalApiId}, got ${bindings.length}`);
    }
    return bindingEndpointToModuleEndpoint(surfaceRef, bindings[0].endpoint!, `${template.id}.binding.endpoint`);
}

function bindingEndpointToModuleEndpoint(
    surface: ModuleBridgeSemantic["from"]["surface"],
    endpoint: AssetEndpoint,
    path: string,
): ModuleBridgeSemantic["sourceGuard"] {
    const base = endpoint.base;
    if (base.kind === "arg") {
        return {
            surface,
            slot: "arg",
            index: base.index,
            ...(endpoint.accessPath && endpoint.accessPath.length > 0 ? { fieldPath: endpoint.accessPath } : {}),
        };
    }
    if (base.kind === "rest") {
        return {
            surface,
            slot: "arg",
            index: base.startIndex,
            rest: true,
            ...(endpoint.accessPath && endpoint.accessPath.length > 0 ? { fieldPath: endpoint.accessPath } : {}),
        };
    }
    if (base.kind === "receiver") {
        return {
            surface,
            slot: "base",
            ...(endpoint.accessPath && endpoint.accessPath.length > 0 ? { fieldPath: endpoint.accessPath } : {}),
        };
    }
    if (base.kind === "return" || base.kind === "constructorResult") {
        return {
            surface,
            slot: "result",
            ...(endpoint.accessPath && endpoint.accessPath.length > 0 ? { fieldPath: endpoint.accessPath } : {}),
        };
    }
    throw new Error(`${path} uses unsupported module bridge source endpoint base ${base.kind}`);
}

function resolvePayloadSurface(asset: AssetDocumentBase, value: Record<string, unknown>, path: string): AssetSurface {
    const surfaceId = typeof value.surfaceId === "string" ? value.surfaceId : undefined;
    const canonicalApiId = typeof value.canonicalApiId === "string" ? value.canonicalApiId : undefined;
    if (!surfaceId && !canonicalApiId) {
        throw new Error(`${path} must include surfaceId or canonicalApiId`);
    }
    const matches = (asset.surfaces || []).filter(surface =>
        (!surfaceId || surface.surfaceId === surfaceId)
        && (!canonicalApiId || surface.canonicalApiId === canonicalApiId)
    );
    if (matches.length !== 1) {
        throw new Error(`${path} must resolve exactly one asset surface, got ${matches.length}`);
    }
    return matches[0];
}

function descriptionFromAsset(asset: AssetDocumentBase): string {
    for (const binding of asset.bindings) {
        const description = binding.metadata?.description;
        if (description) return description;
    }
    return asset.id;
}

function stringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map(item => String(item)).filter(Boolean);
}

function optionalStringArray(value: unknown): string[] | undefined {
    const values = stringArray(value);
    return values.length > 0 ? values : undefined;
}

function objectArray(value: unknown): any[] {
    return Array.isArray(value) ? value.filter(item => !!item && typeof item === "object" && !Array.isArray(item)) : [];
}

function optionalNumber(value: unknown): number | undefined {
    return Number.isInteger(value) ? Number(value) : undefined;
}

function optionalNumberArray(value: unknown): number[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const values = value.filter(Number.isInteger).map(Number);
    return values.length > 0 ? values : undefined;
}
