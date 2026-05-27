import type {
    AssetBinding,
    AssetDocumentBase,
    CoreCapabilityTemplate,
    HandoffGetTemplate,
    HandoffHandleTemplate,
    HandoffKillTemplate,
    HandoffPutTemplate,
    InvokeSurface,
    SemanticEffectTemplate,
} from "../../assets/schema";
import { validateAssetDocument } from "../../assets/schema";
import type {
    ModuleAbilityHandoffSemantic,
    ModuleBridgeSemantic,
    ModuleContainerSemantic,
    ModuleEventEmitterSemantic,
    ModuleKeyedStorageSemantic,
    ModuleRouteBridgeSemantic,
    ModuleSemantic,
    ModuleRuntimeSpec,
    ModuleStateBindingSemantic,
} from "./ModuleRuntimeSpec";

export interface ModuleAssetLoweringOptions {
    includeGenerated?: boolean;
}

export function isModuleAsset(value: unknown): value is AssetDocumentBase {
    return !!value
        && typeof value === "object"
        && !Array.isArray(value)
        && (value as any).plane === "module"
        && Array.isArray((value as any).surfaces)
        && Array.isArray((value as any).bindings);
}

export function lowerModuleAssetToModuleRuntimeSpec(
    asset: AssetDocumentBase,
    options: ModuleAssetLoweringOptions = {},
): ModuleRuntimeSpec {
    const validation = validateAssetDocument(asset);
    if (!validation.valid) {
        throw new Error(`invalid module asset ${asset.id || "<unknown>"}: ${validation.errors.join("; ")}`);
    }
    if (!isAnalysisStatus(asset.status, options)) {
        throw new Error(`module asset ${asset.id} is not loadable with status ${asset.status}`);
    }
    const hasCoreCapability = (asset.effectTemplates || []).some(template => template.kind === "core.capability");
    if (!isAllowedModuleProvenance(asset.provenance.source, options, hasCoreCapability)) {
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

export function lowerModuleAssetsToModuleRuntimeSpecs(
    assets: AssetDocumentBase[],
    options: ModuleAssetLoweringOptions = {},
): ModuleRuntimeSpec[] {
    return assets.map(asset => lowerModuleAssetToModuleRuntimeSpec(asset, options));
}

function isAnalysisStatus(status: AssetDocumentBase["status"], options: ModuleAssetLoweringOptions): boolean {
    if (options.includeGenerated && (status === "candidate" || status === "llm-generated")) {
        return true;
    }
    return status === "schema-valid" || status === "reviewed" || status === "replayed" || status === "official";
}

function isAllowedModuleProvenance(
    source: AssetDocumentBase["provenance"]["source"],
    options: ModuleAssetLoweringOptions,
    hasCoreCapability: boolean,
): boolean {
    if (hasCoreCapability) {
        return source === "builtin" || source === "manual" || source === "sdk";
    }
    if (source === "builtin" || source === "manual" || source === "sdk" || source === "project" || source === "llm") {
        return true;
    }
    return options.includeGenerated && source === "facade-folding";
}

function lowerModuleSemantics(asset: AssetDocumentBase): Array<ModuleSemantic & { id: string }> {
    const templates = asset.effectTemplates || [];
    const coreSemantics = templates
        .filter((template): template is CoreCapabilityTemplate => template.kind === "core.capability")
        .map(template => lowerCoreCapabilityTemplate(asset.id, template));
    const handoffSemantics = lowerHandoffTemplatesToKeyedStorage(asset);
    return [...coreSemantics, ...handoffSemantics];
}

function lowerModuleEffectTemplate(assetId: string, template: SemanticEffectTemplate): ModuleSemantic & { id: string } {
    if (template.kind !== "core.capability") {
        throw new Error(`module asset ${assetId} contains non-core module template ${template.kind}`);
    }
    return lowerCoreCapabilityTemplate(assetId, template);
}

function lowerHandoffTemplatesToKeyedStorage(asset: AssetDocumentBase): Array<ModuleKeyedStorageSemantic & { id: string }> {
    const templates = new Map((asset.effectTemplates || []).map(template => [template.id, template]));
    const storageClasses = new Set<string>();
    const writeMethods = new Map<string, number>();
    const readMethods = new Set<string>();
    const killMethods = new Set<string>();

    for (const binding of asset.bindings || []) {
        if (binding.role !== "handoff" || binding.plane !== "module") continue;
        const surface = findInvokeSurface(asset, binding.surfaceId);
        if (!surface?.ownerName || !surface.methodName) continue;
        for (const ref of binding.effectTemplateRefs || []) {
            const template = templates.get(ref);
            if (!template) continue;
            if (template.kind === "handoff.put") {
                if (!handleUsesFirstArgKey((template as HandoffPutTemplate).handle)) continue;
                const valueIndex = endpointArgIndex((template as HandoffPutTemplate).value);
                if (valueIndex === undefined) continue;
                storageClasses.add(surface.ownerName);
                writeMethods.set(surface.methodName, valueIndex);
                continue;
            }
            if (template.kind === "handoff.get") {
                if (!handleUsesFirstArgKey((template as HandoffGetTemplate).handle)) continue;
                if (!endpointIsReturn((template as HandoffGetTemplate).target)) continue;
                storageClasses.add(surface.ownerName);
                readMethods.add(surface.methodName);
                continue;
            }
            if (template.kind === "handoff.kill") {
                if (!handleUsesFirstArgKey((template as HandoffKillTemplate).handle)) continue;
                storageClasses.add(surface.ownerName);
                killMethods.add(surface.methodName);
            }
        }
    }

    if (storageClasses.size === 0 || (writeMethods.size === 0 && readMethods.size === 0 && killMethods.size === 0)) {
        return [];
    }
    return [{
        id: `${asset.id}.handoff.keyed_storage`,
        kind: "keyed_storage",
        storageClasses: [...storageClasses.values()].sort((a, b) => a.localeCompare(b)),
        writeMethods: [...writeMethods.entries()]
            .map(([methodName, valueIndex]) => ({ methodName, valueIndex }))
            .sort((a, b) => a.methodName.localeCompare(b.methodName)),
        readMethods: [...readMethods.values()].sort((a, b) => a.localeCompare(b)),
        killMethods: [...killMethods.values()].sort((a, b) => a.localeCompare(b)),
    }];
}

function findInvokeSurface(asset: AssetDocumentBase, surfaceId: string): InvokeSurface | undefined {
    const surface = (asset.surfaces || []).find(item => item.surfaceId === surfaceId);
    return surface?.kind === "invoke" ? surface : undefined;
}

function endpointArgIndex(endpoint: HandoffPutTemplate["value"]): number | undefined {
    return endpoint.base.kind === "arg" ? endpoint.base.index : undefined;
}

function endpointIsReturn(endpoint: HandoffGetTemplate["target"]): boolean {
    return endpoint.base.kind === "return";
}

function handleUsesFirstArgKey(handle: HandoffHandleTemplate): boolean {
    return handle.cellKind === "keyed-semantic-slot"
        && handle.key.length === 1
        && handleKeyPartUsesFirstArg(handle.key[0]);
}

function handleKeyPartUsesFirstArg(part: HandoffHandleTemplate["key"][number]): boolean {
    if (part.kind === "fromLiteralArg") return part.index === 0;
    if (part.kind === "fromEndpoint") return part.endpoint.base.kind === "arg" && part.endpoint.base.index === 0;
    if (part.kind === "fromEndpointPath") return part.endpoint.base.kind === "arg" && part.endpoint.base.index === 0;
    return false;
}

function lowerCoreCapabilityTemplate(assetId: string, template: CoreCapabilityTemplate): ModuleSemantic & { id: string } {
    switch (template.capability) {
        case "module.container":
            return moduleContainerSemantic(template);
        case "module.ability-handoff":
            return moduleAbilityHandoffSemantic(template);
        case "module.keyed-storage":
            return moduleKeyedStorageSemantic(template);
        case "module.event-emitter":
            return moduleEventEmitterSemantic(template);
        case "module.route-bridge":
            return moduleRouteBridgeSemantic(template);
        case "module.state-binding":
            return moduleStateBindingSemantic(template);
        case "module.bridge":
            return moduleBridgeSemantic(template);
        default:
            throw new Error(`module asset ${assetId} declares unsupported core capability ${template.capability}`);
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
    };
}

function moduleAbilityHandoffSemantic(template: CoreCapabilityTemplate): ModuleAbilityHandoffSemantic & { id: string } {
    return {
        id: template.id,
        kind: "ability_handoff",
        startMethods: stringArray(template.payload.startMethods),
        targetMethods: stringArray(template.payload.targetMethods),
    };
}

function moduleKeyedStorageSemantic(template: CoreCapabilityTemplate): ModuleKeyedStorageSemantic & { id: string } {
    return {
        id: template.id,
        kind: "keyed_storage",
        storageClasses: stringArray(template.payload.storageClasses),
        writeMethods: objectArray(template.payload.writeMethods) as ModuleKeyedStorageSemantic["writeMethods"],
        readMethods: stringArray(template.payload.readMethods),
        killMethods: optionalStringArray(template.payload.killMethods),
        propDecorators: optionalStringArray(template.payload.propDecorators),
        linkDecorators: optionalStringArray(template.payload.linkDecorators),
    };
}

function moduleEventEmitterSemantic(template: CoreCapabilityTemplate): ModuleEventEmitterSemantic & { id: string } {
    return {
        id: template.id,
        kind: "event_emitter",
        onMethods: optionalStringArray(template.payload.onMethods),
        emitMethods: optionalStringArray(template.payload.emitMethods),
        channelArgIndexes: optionalNumberArray(template.payload.channelArgIndexes),
        payloadArgIndex: optionalNumber(template.payload.payloadArgIndex),
        callbackArgIndex: optionalNumber(template.payload.callbackArgIndex),
        callbackParamIndex: optionalNumber(template.payload.callbackParamIndex),
        maxCandidates: optionalNumber(template.payload.maxCandidates),
    };
}

function moduleRouteBridgeSemantic(template: CoreCapabilityTemplate): ModuleRouteBridgeSemantic & { id: string } {
    return {
        id: template.id,
        kind: "route_bridge",
        pushMethods: objectArray(template.payload.pushMethods) as ModuleRouteBridgeSemantic["pushMethods"],
        getMethods: stringArray(template.payload.getMethods),
        navDestinationClassNames: optionalStringArray(template.payload.navDestinationClassNames),
        navDestinationRegisterMethods: optionalStringArray(template.payload.navDestinationRegisterMethods),
        frameworkSignatureHints: optionalStringArray(template.payload.frameworkSignatureHints),
        payloadUnwrapPrefixes: optionalStringArray(template.payload.payloadUnwrapPrefixes),
    };
}

function moduleStateBindingSemantic(template: CoreCapabilityTemplate): ModuleStateBindingSemantic & { id: string } {
    return {
        id: template.id,
        kind: "state_binding",
        stateDecorators: stringArray(template.payload.stateDecorators),
        propDecorators: stringArray(template.payload.propDecorators),
        linkDecorators: stringArray(template.payload.linkDecorators),
        provideDecorators: optionalStringArray(template.payload.provideDecorators),
        consumeDecorators: optionalStringArray(template.payload.consumeDecorators),
        eventDecorators: optionalStringArray(template.payload.eventDecorators),
    };
}

function moduleBridgeSemantic(template: CoreCapabilityTemplate): ModuleBridgeSemantic & { id: string } {
    const bridge = template.payload.bridge;
    if (!bridge || typeof bridge !== "object" || Array.isArray(bridge)) {
        throw new Error(`module bridge capability ${template.id} requires payload.bridge`);
    }
    return {
        id: template.id,
        kind: "bridge",
        ...(bridge as Omit<ModuleBridgeSemantic, "id" | "kind">),
    };
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
