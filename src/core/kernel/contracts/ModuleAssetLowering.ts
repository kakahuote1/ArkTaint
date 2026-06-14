import type {
    AnalysisAssetLoadMode,
    AssetDocumentBase,
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
        .map(template => lowerCoreCapabilityTemplate(asset.id, template));
    const moduleEventEmitterSemantics = templates
        .filter((template): template is ModuleEventEmitterTemplate => template.kind === "module.eventEmitter")
        .map(template => moduleEventEmitterSemantic(template));
    const handoffEffectSemantics = lowerHandoffTemplatesToEffectSemantics(asset);
    return [...coreSemantics, ...moduleEventEmitterSemantics, ...handoffEffectSemantics];
}

function lowerModuleEffectTemplate(assetId: string, template: SemanticEffectTemplate): ModuleSemantic & { id: string } {
    if (template.kind !== "core.capability") {
        throw new Error(`module asset ${assetId} contains non-core module template ${template.kind}`);
    }
    return lowerCoreCapabilityTemplate(assetId, template);
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

function tryLowerHandoffEffectsToKeyedStorage(
    assetId: string,
    effects: ModuleHandoffEffectSemantic["effects"],
): (ModuleKeyedStorageSemantic & { id: string }) | undefined {
    if (effects.length === 0) {
        return undefined;
    }
    const storageClasses = new Set<string>();
    const writeMethods: ModuleKeyedStorageSemantic["writeMethods"] = [];
    const readMethods = new Set<string>();
    const killMethods = new Set<string>();
    let expectedHandleKey: string | undefined;

    for (const effect of effects) {
        const methodName = effect.surface.surfaceKind === "construct" ? undefined : effect.surface.methodName;
        const storageClass = effect.surface.surfaceKind === "construct" ? undefined : effect.surface.declaringClassName;
        if (!methodName || !storageClass) {
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
        storageClasses.add(storageClass);
        if (effect.effectKind === "put") {
            const valueIndex = endpointArgIndex(effect.value);
            if (valueIndex === undefined) {
                return undefined;
            }
            writeMethods.push({ methodName, valueIndex });
            continue;
        }
        if (effect.effectKind === "get") {
            readMethods.add(methodName);
            continue;
        }
        if (effect.effectKind === "kill") {
            killMethods.add(methodName);
        }
    }

    if (storageClasses.size === 0 || writeMethods.length === 0 || readMethods.size === 0) {
        return undefined;
    }
    return {
        id: `${assetId}.keyed_storage`,
        kind: "keyed_storage",
        storageClasses: [...storageClasses].sort(),
        writeMethods: dedupeWriteMethods(writeMethods),
        readMethods: [...readMethods].sort(),
        ...(killMethods.size > 0 ? { killMethods: [...killMethods].sort() } : {}),
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

function dedupeWriteMethods(
    methods: ModuleKeyedStorageSemantic["writeMethods"],
): ModuleKeyedStorageSemantic["writeMethods"] {
    const byKey = new Map<string, ModuleKeyedStorageSemantic["writeMethods"][number]>();
    for (const method of methods) {
        byKey.set(`${method.methodName}#${method.valueIndex}`, method);
    }
    return [...byKey.values()].sort((left, right) =>
        left.methodName.localeCompare(right.methodName)
        || left.valueIndex - right.valueIndex,
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
    const selectorModulePath = surface.invokeKind === "namespace"
        ? undefined
        : surface.modulePath;
    const selectorOwnerName = surface.invokeKind === "namespace" || surface.invokeKind === "free-function"
        ? undefined
        : surface.ownerName;
    return {
        surfaceKind: "invoke" as const,
        ...(surface.signatureId ? { signature: surface.signatureId } : {}),
        ...(selectorModulePath ? { modulePath: selectorModulePath } : {}),
        methodName: surface.methodName || surface.functionName,
        declaringClassName: selectorOwnerName,
        ...(surface.invokeKind === "namespace" && surface.ownerName ? { baseLocalName: surface.ownerName } : {}),
        argCount: surface.argCount,
        ...(surface.invokeKind === "instance" ? { instanceOnly: true } : {}),
        ...(surface.invokeKind === "static" ? { staticOnly: true } : {}),
    };
}

function constructSurfaceToModuleSelector(surface: ConstructSurface) {
    return {
        surfaceKind: "construct" as const,
        ...(surface.signatureId ? { signature: surface.signatureId } : {}),
        ...(surface.modulePath ? { modulePath: surface.modulePath } : {}),
        className: surface.className,
        argCount: surface.argCount,
    };
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

function moduleEventEmitterSemantic(template: CoreCapabilityTemplate | ModuleEventEmitterTemplate): ModuleEventEmitterSemantic & { id: string } {
    const payload = template.kind === "core.capability" ? template.payload : template;
    return {
        id: template.id,
        kind: "event_emitter",
        onMethods: optionalStringArray(payload.onMethods),
        emitMethods: optionalStringArray(payload.emitMethods),
        channelArgIndexes: optionalNumberArray(payload.channelArgIndexes),
        payloadArgIndex: optionalNumber(payload.payloadArgIndex),
        callbackArgIndex: optionalNumber(payload.callbackArgIndex),
        callbackParamIndex: optionalNumber(payload.callbackParamIndex),
        maxCandidates: optionalNumber(payload.maxCandidates),
    };
}

function moduleRouteBridgeSemantic(template: CoreCapabilityTemplate): ModuleRouteBridgeSemantic & { id: string } {
    return {
        id: template.id,
        kind: "route_bridge",
        pushMethods: objectArray(template.payload.pushMethods) as ModuleRouteBridgeSemantic["pushMethods"],
        getMethods: stringArray(template.payload.getMethods),
        routerClassNames: optionalStringArray(template.payload.routerClassNames),
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
