import type { AssetDocumentBase } from "./AssetTypes";
import type { AssetBinding } from "./BindingTypes";
import { result, type ValidationResult } from "./CommonTypes";
import type { AssetEndpoint, CallbackLocator } from "./EndpointTypes";
import type { SemanticEffectTemplate } from "./EffectTemplateTypes";
import { SEMANTIC_EFFECT_KINDS } from "./EffectTemplateTypes";
import type { AssetRelation } from "./RelationTypes";
import type { AssetSurface } from "./SurfaceTypes";
import { DEFAULT_CELL_KIND_REGISTRY, type CellKindRegistry } from "../../cellkind";
import { assertValidCanonicalApiId } from "../../api/identity/CanonicalApiId";
import type { CanonicalApiDescriptor } from "../../api/identity/CanonicalApiDescriptor";

const trustedStatuses = new Set(["official", "reviewed", "replayed"]);
const forbiddenKeys = new Set([
    "schemaVersion",
    "modelVersion",
    "assetVersion",
    "semanticsRef",
    "coverageSurfaces",
    "runtimeShape",
    "modulePath",
    "ownerName",
    "functionName",
    "methodName",
    "invokeKind",
    "argCount",
    "parameterTypes",
    "returnType",
    "signatureId",
    "callee_signature",
    "sourceFile",
    "decoratorName",
    "startMethods",
    "targetMethods",
    "stateDecorators",
    "propDecorators",
    "linkDecorators",
    "provideDecorators",
    "consumeDecorators",
    "eventDecorators",
    "ValueEndpoint",
    "ModelStatus",
]);

const legacySurfaceIdentityKeys = new Set([
    "runtimeShape",
    "modulePath",
    "ownerName",
    "functionName",
    "methodName",
    "className",
    "propertyName",
    "decoratorName",
    "ownerKind",
    "fieldName",
    "phase",
    "entryKind",
    "invokeKind",
    "argCount",
    "parameterTypes",
    "returnType",
    "signatureId",
    "callee_signature",
    "sourceFile",
]);

export interface AssetDocumentValidationOptions {
    cellKindRegistry?: Pick<CellKindRegistry, "has">;
    canonicalApiDescriptors?:
        | Iterable<CanonicalApiDescriptor>
        | Map<string, CanonicalApiDescriptor>
        | ((canonicalApiId: string) => CanonicalApiDescriptor | undefined);
}

interface NormalizedValidationOptions {
    cellKindRegistry: Pick<CellKindRegistry, "has">;
    resolveCanonicalApiDescriptor(canonicalApiId: string): CanonicalApiDescriptor | undefined;
}

export function validateAssetDocument(asset: unknown, options: AssetDocumentValidationOptions = {}): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const validationOptions = normalizeValidationOptions(options);

    if (!isObject(asset)) {
        return result(["asset must be an object"]);
    }

    collectForbiddenFields(asset, "$", errors);

    const doc = asset as Partial<AssetDocumentBase>;
    requireString(doc.id, "$.id", errors);
    requireOneOf(doc.plane, ["rule", "module", "arkmain"], "$.plane", errors);
    requireOneOf(doc.status, [
        "candidate",
        "llm-generated",
        "schema-valid",
        "reviewed",
        "replayed",
        "official",
        "deprecated",
        "rejected",
    ], "$.status", errors);

    const surfaces = Array.isArray(doc.surfaces) ? doc.surfaces : [];
    const bindings = Array.isArray(doc.bindings) ? doc.bindings : [];
    const templates = Array.isArray(doc.effectTemplates) ? doc.effectTemplates : [];
    const relations = Array.isArray(doc.relations) ? doc.relations : [];

    if (!Array.isArray(doc.surfaces)) errors.push("$.surfaces must be an array");
    if (!Array.isArray(doc.bindings)) errors.push("$.bindings must be an array");
    if (doc.effectTemplates !== undefined && !Array.isArray(doc.effectTemplates)) {
        errors.push("$.effectTemplates must be an array when present");
    }
    if (doc.relations !== undefined && !Array.isArray(doc.relations)) {
        errors.push("$.relations must be an array when present");
    }
    if (!isObject(doc.provenance)) errors.push("$.provenance must be an object");

    const trustedAsset = typeof doc.status === "string" && trustedStatuses.has(doc.status);
    const identityRequired = typeof doc.status === "string" && doc.status !== "deprecated" && doc.status !== "rejected";

    if (trustedAsset) {
        if (surfaces.length === 0) errors.push(`trusted asset ${doc.id || "<unknown>"} must declare at least one surface`);
        if (bindings.length === 0) errors.push(`trusted asset ${doc.id || "<unknown>"} must declare at least one binding`);
    }

    const surfaceIds = new Set<string>();
    const surfacesById = new Map<string, AssetSurface>();
    surfaces.forEach((surface, index) => {
        validateSurface(surface as AssetSurface, `$.surfaces[${index}]`, errors, identityRequired);
        if (isObject(surface) && typeof (surface as any).surfaceId === "string") {
            if (surfaceIds.has((surface as any).surfaceId)) {
                errors.push(`duplicate surfaceId ${(surface as any).surfaceId}`);
            }
            surfaceIds.add((surface as any).surfaceId);
            surfacesById.set((surface as any).surfaceId, surface as AssetSurface);
        }
    });

    const templateIds = new Set<string>();
    const templatesById = new Map<string, SemanticEffectTemplate>();
    templates.forEach((template, index) => {
        validateTemplate(template as SemanticEffectTemplate, `$.effectTemplates[${index}]`, errors, validationOptions);
        validateTemplatePlaneCompatibility(doc.plane, template as SemanticEffectTemplate, `$.effectTemplates[${index}]`, errors);
        if (isObject(template) && typeof (template as any).id === "string") {
            if (templateIds.has((template as any).id)) errors.push(`duplicate effect template id ${(template as any).id}`);
            templateIds.add((template as any).id);
            templatesById.set((template as any).id, template as SemanticEffectTemplate);
        }
    });

    const relationIds = new Set<string>();
    relations.forEach((relation, index) => {
        validateRelation(relation as AssetRelation, `$.relations[${index}]`, surfaceIds, errors);
        if (isObject(relation) && typeof (relation as any).relationId === "string") {
            if (relationIds.has((relation as any).relationId)) errors.push(`duplicate relationId ${(relation as any).relationId}`);
            relationIds.add((relation as any).relationId);
        }
    });

    bindings.forEach((binding, index) => {
        validateBinding(binding as AssetBinding, `$.bindings[${index}]`, {
            assetPlane: doc.plane,
            identityRequired,
            surfaceIds,
            surfacesById,
            templateIds,
            relationIds,
            templatesById,
            validationOptions,
            errors,
        });
    });

    validateConstructSurfaceEndpointCompatibility(surfacesById, bindings as AssetBinding[], templatesById, errors);
    validatePairedHandoffHandleFamilies(surfaces as AssetSurface[], bindings as AssetBinding[], templates as SemanticEffectTemplate[], errors);

    if (isObject(doc.provenance) && (doc.provenance as any).source === "llm") {
        for (const template of templates) {
            if ((template as any)?.kind === "core.capability") {
                errors.push("LLM assets must not declare core.capability templates");
            }
        }
    }

    return result(errors, warnings);
}

function validatePairedHandoffHandleFamilies(
    surfaces: AssetSurface[],
    bindings: AssetBinding[],
    templates: SemanticEffectTemplate[],
    errors: string[],
): void {
    const surfacesById = new Map<string, AssetSurface>();
    for (const surface of surfaces) {
        if (isObject(surface) && typeof (surface as any).surfaceId === "string") {
            surfacesById.set((surface as any).surfaceId, surface);
        }
    }

    const templateToSurfaceOwner = new Map<string, Set<string>>();
    for (const binding of bindings) {
        if (!isObject(binding) || !Array.isArray((binding as any).effectTemplateRefs)) continue;
        const ownerKey = surfaceOwnerKey(surfacesById.get((binding as any).surfaceId));
        if (!ownerKey) continue;
        for (const ref of (binding as any).effectTemplateRefs) {
            if (typeof ref !== "string") continue;
            let owners = templateToSurfaceOwner.get(ref);
            if (!owners) {
                owners = new Set<string>();
                templateToSurfaceOwner.set(ref, owners);
            }
            owners.add(ownerKey);
        }
    }

    const groups = new Map<string, { family: string; templateId: string; kind: string }>();
    for (const template of templates) {
        if (!isObject(template) || typeof (template as any).id !== "string") continue;
        const handle = primaryHandoffHandle(template);
        if (!handle || !isObject(handle)) continue;
        const family = typeof (handle as any).family === "string" ? (handle as any).family : "";
        if (!family) continue;
        const ownerKeys = templateToSurfaceOwner.get((template as any).id);
        if (!ownerKeys || ownerKeys.size === 0) continue;
        for (const ownerKey of ownerKeys) {
            const key = [
                ownerKey,
                String((handle as any).cellKind || ""),
                canonicalHandlePartArray((handle as any).scope),
                canonicalHandlePartArray((handle as any).key),
                canonicalHandlePartArray((handle as any).owner),
                (handle as any).index === undefined ? "" : String((handle as any).index),
            ].join("|");
            const previous = groups.get(key);
            if (previous && previous.family !== family) {
                errors.push(
                    `paired handoff templates for ${ownerKey} over the same cellKind/key/scope/owner layout must use the same handle.family: ` +
                    `${previous.templateId} (${previous.kind}) uses ${previous.family}, ${(template as any).id} (${(template as any).kind}) uses ${family}`,
                );
                continue;
            }
            groups.set(key, {
                family,
                templateId: (template as any).id,
                kind: String((template as any).kind || ""),
            });
        }
    }
}

function primaryHandoffHandle(template: SemanticEffectTemplate): unknown {
    const kind = (template as any).kind;
    if (kind === "handoff.put" || kind === "handoff.get" || kind === "handoff.kill") {
        return (template as any).handle;
    }
    return undefined;
}

function surfaceOwnerKey(surface: AssetSurface | undefined): string | undefined {
    if (!surface || !isObject(surface)) return undefined;
    const canonicalApiId = String((surface as any).canonicalApiId || "").trim();
    return canonicalApiId || undefined;
}

function canonicalHandlePartArray(value: unknown): string {
    if (value === undefined) return "<absent>";
    if (!Array.isArray(value)) return "<invalid>";
    return JSON.stringify(value.map(canonicalHandlePartTemplate));
}

function canonicalHandlePartTemplate(part: unknown): unknown {
    if (!isObject(part)) return part;
    const kind = (part as any).kind;
    if (kind === "fromEndpointPath") {
        return {
            kind,
            endpoint: canonicalEndpoint((part as any).endpoint),
            accessPath: Array.isArray((part as any).accessPath) ? (part as any).accessPath.map(String) : [],
        };
    }
    if (kind === "fromEndpoint") {
        return {
            kind,
            endpoint: canonicalEndpoint((part as any).endpoint),
        };
    }
    return Object.fromEntries(Object.entries(part).sort(([left], [right]) => left.localeCompare(right)));
}

function canonicalEndpoint(endpoint: unknown): unknown {
    if (!isObject(endpoint)) return endpoint;
    return {
        base: isObject((endpoint as any).base)
            ? Object.fromEntries(Object.entries((endpoint as any).base).sort(([left], [right]) => left.localeCompare(right)))
            : (endpoint as any).base,
        accessPath: Array.isArray((endpoint as any).accessPath) ? (endpoint as any).accessPath.map(String) : undefined,
    };
}

function validateTemplatePlaneCompatibility(
    plane: unknown,
    template: SemanticEffectTemplate,
    path: string,
    errors: string[],
): void {
    if (plane !== "rule" && plane !== "module" && plane !== "arkmain") return;
    if (!isObject(template) || typeof (template as any).kind !== "string") return;
    const kind = (template as any).kind as string;
    const compatible =
        (plane === "rule" && kind.startsWith("rule.")) ||
        (plane === "module" && (kind.startsWith("handoff.") || kind === "module.eventEmitter" || kind === "core.capability")) ||
        (plane === "arkmain" && (kind.startsWith("entry.") || kind === "core.capability"));
    if (!compatible) {
        errors.push(`${path}.kind ${kind} is not compatible with asset plane ${plane}`);
    }
}

function normalizeValidationOptions(options: AssetDocumentValidationOptions): NormalizedValidationOptions {
    const resolver = normalizeCanonicalApiDescriptorResolver(options.canonicalApiDescriptors);
    return {
        cellKindRegistry: options.cellKindRegistry || DEFAULT_CELL_KIND_REGISTRY,
        resolveCanonicalApiDescriptor: resolver,
    };
}

function normalizeCanonicalApiDescriptorResolver(
    descriptors: AssetDocumentValidationOptions["canonicalApiDescriptors"],
): (canonicalApiId: string) => CanonicalApiDescriptor | undefined {
    if (!descriptors) return () => undefined;
    if (typeof descriptors === "function") return descriptors;
    const map = descriptors instanceof Map
        ? descriptors
        : new Map([...descriptors].map(descriptor => [descriptor.canonicalApiId, descriptor]));
    return canonicalApiId => map.get(canonicalApiId);
}

function validateSurface(surface: AssetSurface, path: string, errors: string[], trustedAsset: boolean): void {
    if (!isObject(surface)) {
        errors.push(`${path} must be an object`);
        return;
    }
    requireString((surface as any).surfaceId, `${path}.surfaceId`, errors);
    validateCanonicalApiIdField((surface as any).canonicalApiId, `${path}.canonicalApiId`, errors, { required: trustedAsset });
    rejectLegacySurfaceIdentityFields(surface, path, errors);
    validateSurfaceEvidence((surface as any).evidence, `${path}.evidence`, errors);
    requireOneOf((surface as any).confidence, ["certain", "likely", "unknown"], `${path}.confidence`, errors);
    if (!isObject((surface as any).provenance)) errors.push(`${path}.provenance must be an object`);
    switch ((surface as any).kind) {
        case "invoke":
        case "construct":
        case "access":
        case "entry":
        case "decorator":
            break;
        case "callback":
            if ((surface as any).registrar !== undefined) validateCanonicalSurfaceRef((surface as any).registrar, `${path}.registrar`, errors);
            if (!isObject((surface as any).callback)) errors.push(`${path}.callback must be a CallbackLocator`);
            break;
        default:
            errors.push(`${path}.kind is not a registered AssetSurface kind`);
    }
}

function rejectLegacySurfaceIdentityFields(surface: AssetSurface, path: string, errors: string[]): void {
    for (const key of Object.keys(surface as any)) {
        if (legacySurfaceIdentityKeys.has(key)) {
            errors.push(`${path}.${key} is a forbidden legacy surface identity field; put declaration facts under evidence`);
        }
    }
}

function validateCanonicalSurfaceRef(value: unknown, path: string, errors: string[]): void {
    if (!isObject(value)) {
        errors.push(`${path} must be an object`);
        return;
    }
    requireString((value as any).surfaceId, `${path}.surfaceId`, errors);
    validateCanonicalApiIdField((value as any).canonicalApiId, `${path}.canonicalApiId`, errors, { required: true });
}

function validateSurfaceEvidence(value: unknown, path: string, errors: string[]): void {
    if (value === undefined) return;
    if (!isObject(value)) {
        errors.push(`${path} must be an object when present`);
        return;
    }
    if ((value as any).arkanalyzer !== undefined) validateArkanalyzerEvidence((value as any).arkanalyzer, `${path}.arkanalyzer`, errors);
    for (const key of Object.keys(value)) {
        if (key !== "arkanalyzer") {
            errors.push(`${path}.${key} is not a supported surface evidence field`);
        }
    }
}

function validateArkanalyzerEvidence(value: unknown, path: string, errors: string[]): void {
    if (!isObject(value)) {
        errors.push(`${path} must be an object`);
        return;
    }
    validateArkanalyzerMethodKeyEvidence((value as any).methodKey, `${path}.methodKey`, errors);
    for (const key of Object.keys(value)) {
        if (key !== "methodKey") {
            errors.push(`${path}.${key} is not a supported Arkanalyzer evidence field`);
        }
    }
}

function validateArkanalyzerMethodKeyEvidence(value: unknown, path: string, errors: string[]): void {
    if (!isObject(value)) {
        errors.push(`${path} must be an object`);
        return;
    }
    requireStableString((value as any).declaringFileName, `${path}.declaringFileName`, errors);
    if ((value as any).declaringNamespacePath !== undefined) validateStringArray((value as any).declaringNamespacePath, `${path}.declaringNamespacePath`, errors, { allowEmpty: true });
    requireStableString((value as any).declaringClassName, `${path}.declaringClassName`, errors);
    requireStableString((value as any).methodName, `${path}.methodName`, errors);
    validateStringArray((value as any).parameterTypes, `${path}.parameterTypes`, errors, { allowEmpty: true });
    requireStableString((value as any).returnType, `${path}.returnType`, errors);
    if (typeof (value as any).staticFlag !== "boolean") errors.push(`${path}.staticFlag must be a boolean`);
}

function validateTemplate(
    template: SemanticEffectTemplate,
    path: string,
    errors: string[],
    options: NormalizedValidationOptions,
): void {
    if (!isObject(template)) {
        errors.push(`${path} must be an object`);
        return;
    }
    requireString((template as any).id, `${path}.id`, errors);
    const kind = (template as any).kind;
    if (!SEMANTIC_EFFECT_KINDS.includes(kind)) {
        errors.push(`${path}.kind is not registered: ${String((template as any).kind)}`);
        return;
    }
    switch (kind) {
        case "rule.source":
            requireOneOf((template as any).sourceKind, ["seed_local_name", "entry_param", "call_return", "call_arg", "field_read", "callback_param", "bound_state"], `${path}.sourceKind`, errors);
            validateRuleValueRef((template as any).value, `${path}.value`, errors);
            return;
        case "rule.sink":
            requireString((template as any).sinkKind, `${path}.sinkKind`, errors);
            rejectTemplateEndpointField(template, path, errors);
            if ((template as any).value !== undefined) {
                validateRuleValueRef((template as any).value, `${path}.value`, errors);
                validateSinkEndpoint((template as any).value, `${path}.value`, errors);
            }
            return;
        case "rule.sanitizer":
            requireString((template as any).sanitizerKind, `${path}.sanitizerKind`, errors);
            requireOneOf((template as any).strength, ["strong", "weak", "unknown"], `${path}.strength`, errors);
            rejectTemplateEndpointField(template, path, errors);
            if ((template as any).value !== undefined) validateRuleValueRef((template as any).value, `${path}.value`, errors);
            return;
        case "rule.transfer":
            validateRuleValueRef((template as any).from, `${path}.from`, errors);
            validateRuleValueRef((template as any).to, `${path}.to`, errors);
            return;
        case "handoff.put":
            validateHandoffHandleTemplate((template as any).handle, `${path}.handle`, errors, options);
            validateEndpoint((template as any).value, `${path}.value`, errors);
            validateOptionalUpdateStrength((template as any).updateStrength, `${path}.updateStrength`, errors);
            return;
        case "handoff.get":
            validateHandoffHandleTemplate((template as any).handle, `${path}.handle`, errors, options);
            validateEndpoint((template as any).target, `${path}.target`, errors);
            return;
        case "handoff.kill":
            validateHandoffHandleTemplate((template as any).handle, `${path}.handle`, errors, options);
            validateOptionalUpdateStrength((template as any).updateStrength, `${path}.updateStrength`, errors);
            return;
        case "handoff.link":
            validateHandoffHandleTemplate((template as any).left, `${path}.left`, errors, options);
            validateHandoffHandleTemplate((template as any).right, `${path}.right`, errors, options);
            if ((template as any).scope !== undefined && !isObject((template as any).scope)) errors.push(`${path}.scope must be an AssetGuard`);
            return;
        case "entry.lifecycle":
            requireString((template as any).entryKind, `${path}.entryKind`, errors);
            requireString((template as any).phase, `${path}.phase`, errors);
            if ((template as any).method !== undefined) {
                errors.push(`${path}.method is a forbidden legacy entry identity field; use surface canonicalApiId`);
            }
            if ((template as any).ownerKind !== undefined) requireString((template as any).ownerKind, `${path}.ownerKind`, errors);
            if ((template as any).entryShape !== undefined) requireString((template as any).entryShape, `${path}.entryShape`, errors);
            return;
        case "entry.callbackRegister":
            validateCallbackLocator((template as any).callback, `${path}.callback`, errors);
            return;
        case "entry.scheduleUnit":
            validateEndpoint((template as any).unit, `${path}.unit`, errors);
            requireString((template as any).scheduleKind, `${path}.scheduleKind`, errors);
            return;
        case "entry.frameworkInvoke":
            validateEndpoint((template as any).target, `${path}.target`, errors);
            return;
        case "module.eventEmitter":
            validateModuleEventEmitterTemplate(template as any, path, errors);
            return;
        case "core.capability":
            requireString((template as any).capability, `${path}.capability`, errors);
            if (!isObject((template as any).payload)) errors.push(`${path}.payload must be an object`);
            return;
    }
}

function validateModuleEventEmitterTemplate(template: Record<string, unknown>, path: string, errors: string[]): void {
    validateStringArray(template.onCanonicalApiIds, `${path}.onCanonicalApiIds`, errors, { allowEmpty: false });
    validateStringArray(template.emitCanonicalApiIds, `${path}.emitCanonicalApiIds`, errors, { allowEmpty: false });
    if (template.channelArgIndexes !== undefined) {
        validateIntegerArray(template.channelArgIndexes, `${path}.channelArgIndexes`, errors, { min: 0, allowEmpty: false });
    }
    if (template.payloadArgIndex !== undefined) {
        validateInteger(template.payloadArgIndex, `${path}.payloadArgIndex`, errors, { min: -1 });
    }
    if (template.callbackArgIndex !== undefined) {
        validateInteger(template.callbackArgIndex, `${path}.callbackArgIndex`, errors, { min: 0 });
    }
    if (template.callbackParamIndex !== undefined) {
        validateInteger(template.callbackParamIndex, `${path}.callbackParamIndex`, errors, { min: 0 });
    }
    if (template.maxCandidates !== undefined) {
        validateInteger(template.maxCandidates, `${path}.maxCandidates`, errors, { min: 1 });
    }
}

function rejectTemplateEndpointField(template: SemanticEffectTemplate, path: string, errors: string[]): void {
    if ((template as any).endpoint !== undefined) {
        errors.push(`${path}.endpoint is not a rule effect template field; use value or binding.endpoint`);
    }
}

function validateOptionalUpdateStrength(value: unknown, path: string, errors: string[]): void {
    if (value !== undefined) {
        requireOneOf(value, ["strong", "weak"], path, errors);
    }
}

function validateRuleValueRef(value: unknown, path: string, errors: string[]): void {
    if (!isObject(value)) {
        errors.push(`${path} must be an AssetEndpoint or EndpointSelectorRef`);
        return;
    }
    if (isObject((value as any).endpoint)) {
        validateEndpoint((value as any).endpoint, `${path}.endpoint`, errors);
        if ((value as any).pathFrom !== undefined) validateEndpoint((value as any).pathFrom, `${path}.pathFrom`, errors);
        if ((value as any).slotKind !== undefined) requireString((value as any).slotKind, `${path}.slotKind`, errors);
        if ((value as any).slotWriteMode !== undefined) {
            requireOneOf((value as any).slotWriteMode, ["replace", "append"], `${path}.slotWriteMode`, errors);
            if ((value as any).pathFrom === undefined || (value as any).slotKind === undefined) {
                errors.push(`${path}.slotWriteMode requires pathFrom and slotKind`);
            }
        }
        if ((value as any).taintScope !== undefined) {
            requireOneOf((value as any).taintScope, ["self", "contained-values"], `${path}.taintScope`, errors);
        }
        return;
    }
    validateEndpoint(value, path, errors);
}

function validateTemplateEndpointProjectability(
    template: SemanticEffectTemplate | undefined,
    descriptor: CanonicalApiDescriptor,
    path: string,
    errors: string[],
): void {
    if (!template || !isObject(template)) return;
    for (const [field, endpoint] of collectTemplateEndpointFields(template)) {
        validateEndpointProjectability(endpoint, descriptor, `${path}.${field}`, errors);
    }
    for (const [field, handle] of collectTemplateHandleFields(template)) {
        validateHandleEndpointProjectability(handle, descriptor, `${path}.${field}`, errors);
    }
}

function collectTemplateEndpointFields(template: SemanticEffectTemplate): Array<[string, unknown]> {
    const out: Array<[string, unknown]> = [];
    for (const field of ["value", "from", "to", "target", "unit"] as const) {
        const raw = (template as any)[field];
        if (raw === undefined) continue;
        const endpoint = normalizeRuleEndpoint(raw);
        if (endpoint) out.push([field, endpoint]);
    }
    return out;
}

function collectTemplateHandleFields(template: SemanticEffectTemplate): Array<[string, unknown]> {
    const out: Array<[string, unknown]> = [];
    for (const field of ["handle", "left", "right"] as const) {
        const raw = (template as any)[field];
        if (raw !== undefined) out.push([field, raw]);
    }
    return out;
}

function validateHandleEndpointProjectability(
    handle: unknown,
    descriptor: CanonicalApiDescriptor,
    path: string,
    errors: string[],
): void {
    if (!isObject(handle)) return;
    for (const partArrayField of ["key", "scope", "owner"] as const) {
        const parts = (handle as any)[partArrayField];
        if (!Array.isArray(parts)) continue;
        parts.forEach((part, index) => {
            if (!isObject(part)) return;
            if ((part as any).kind === "fromEndpoint" || (part as any).kind === "fromEndpointPath") {
                validateEndpointProjectability(
                    (part as any).endpoint,
                    descriptor,
                    `${path}.${partArrayField}[${index}].endpoint`,
                    errors,
                );
            }
            if ((part as any).kind === "fromLiteralArg") {
                validateEndpointProjectability(
                    { base: { kind: "arg", index: (part as any).index } },
                    descriptor,
                    `${path}.${partArrayField}[${index}]`,
                    errors,
                );
            }
        });
    }
}

function validateEndpointProjectability(
    endpoint: unknown,
    descriptor: CanonicalApiDescriptor,
    path: string,
    errors: string[],
): void {
    if (!isObject(endpoint) || !isObject((endpoint as any).base)) return;
    const base = (endpoint as unknown as AssetEndpoint).base;
    switch (base.kind) {
        case "arg":
            validateArgumentEndpointProjectability(base.index, descriptor, path, errors);
            return;
        case "rest":
            validateRestEndpointProjectability(base.startIndex, descriptor, path, errors);
            return;
        case "receiver":
            if (!descriptorHasReceiver(descriptor)) {
                errors.push(`${path} receiver_not_projectable for canonical descriptor ${descriptor.canonicalApiId}`);
            }
            return;
        case "return":
            if (!descriptorHasReturnValue(descriptor)) {
                errors.push(`${path} return_not_projectable for canonical descriptor ${descriptor.canonicalApiId}`);
            }
            return;
        case "promiseResult":
            if (!descriptorReturnsPromise(descriptor)) {
                errors.push(`${path} promise_result_not_projectable for non-Promise canonical descriptor ${descriptor.canonicalApiId}`);
            }
            return;
        case "promiseRejected":
            if (!descriptorReturnsPromise(descriptor)) {
                errors.push(`${path} promise_rejected_not_projectable for non-Promise canonical descriptor ${descriptor.canonicalApiId}`);
            }
            return;
        case "constructorResult":
            if (!descriptorIsConstructor(descriptor)) {
                errors.push(`${path} constructor_result_not_projectable for non-constructor canonical descriptor ${descriptor.canonicalApiId}`);
            }
            return;
        case "callbackArg":
            validateCallbackLocatorProjectability(base.callback, descriptor, `${path}.base.callback`, errors);
            requireNonNegativeInteger(base.argIndex, `${path}.base.argIndex`, errors);
            return;
        case "callbackReturn":
            validateCallbackLocatorProjectability(base.callback, descriptor, `${path}.base.callback`, errors);
            return;
    }
}

function validateArgumentEndpointProjectability(
    index: number,
    descriptor: CanonicalApiDescriptor,
    path: string,
    errors: string[],
): void {
    const parameters = descriptor.signature?.parameters || [];
    const parameter = parameters.find(item => item.index === index);
    if (!parameter) {
        errors.push(`${path} arg_out_of_range index ${index} for canonical descriptor ${descriptor.canonicalApiId}`);
        return;
    }
    if (parameter.rest === true && index !== restParameterIndex(parameters)) {
        errors.push(`${path} rest parameter index ${index} must match canonical rest parameter`);
    }
}

function validateRestEndpointProjectability(
    startIndex: number,
    descriptor: CanonicalApiDescriptor,
    path: string,
    errors: string[],
): void {
    const parameters = descriptor.signature?.parameters || [];
    const restIndex = restParameterIndex(parameters);
    if (restIndex === undefined) {
        errors.push(`${path} rest_out_of_range no canonical rest parameter for descriptor ${descriptor.canonicalApiId}`);
        return;
    }
    if (startIndex !== restIndex) {
        errors.push(`${path} rest_out_of_range startIndex ${startIndex} must match canonical rest parameter ${restIndex}`);
    }
}

function validateCallbackLocatorProjectability(
    locator: CallbackLocator,
    descriptor: CanonicalApiDescriptor,
    path: string,
    errors: string[],
): void {
    if (!isObject(locator)) return;
    if (locator.kind === "arg") {
        validateArgumentEndpointProjectability(locator.index, descriptor, path, errors);
        return;
    }
    if (locator.kind === "option") {
        validateEndpointProjectability(locator.base, descriptor, `${path}.base`, errors);
    }
}

function descriptorHasReceiver(descriptor: CanonicalApiDescriptor): boolean {
    if (descriptor.invoke.kind === "new") return false;
    if (descriptor.member.kind === "constructor" || descriptor.member.kind === "function") return false;
    return descriptor.member.static !== true;
}

function descriptorHasReturnValue(descriptor: CanonicalApiDescriptor): boolean {
    const returnType = String(descriptor.signature?.returnType?.text || "").trim().toLowerCase();
    return returnType.length > 0 && returnType !== "void" && returnType !== "undefined" && returnType !== "never";
}

function descriptorReturnsPromise(descriptor: CanonicalApiDescriptor): boolean {
    return /\bPromise\s*</.test(String(descriptor.signature?.returnType?.text || ""));
}

function descriptorIsConstructor(descriptor: CanonicalApiDescriptor): boolean {
    return descriptor.invoke.kind === "new" || descriptor.member.kind === "constructor";
}

function restParameterIndex(parameters: readonly { index: number; rest?: boolean }[]): number | undefined {
    const rest = parameters.filter(parameter => parameter.rest === true);
    if (rest.length !== 1) return undefined;
    return rest[0].index;
}

function validateEndpoint(endpoint: unknown, path: string, errors: string[]): void {
    if (!isObject(endpoint)) {
        errors.push(`${path} must be an AssetEndpoint`);
        return;
    }
    const base = (endpoint as any).base;
    if (!isObject(base)) {
        errors.push(`${path}.base must be an object`);
        return;
    }
    const kind = (base as any).kind;
    requireOneOf(kind, ["receiver", "arg", "rest", "return", "callbackArg", "callbackReturn", "promiseResult", "promiseRejected", "constructorResult"], `${path}.base.kind`, errors);
    if (kind === "arg") {
        requireNonNegativeInteger((base as any).index, `${path}.base.index`, errors);
    }
    if (kind === "rest") {
        requireNonNegativeInteger((base as any).startIndex, `${path}.base.startIndex`, errors);
    }
    if (kind === "callbackArg") {
        validateCallbackLocator((base as any).callback, `${path}.base.callback`, errors);
        requireNonNegativeInteger((base as any).argIndex, `${path}.base.argIndex`, errors);
    }
    if (kind === "callbackReturn") {
        validateCallbackLocator((base as any).callback, `${path}.base.callback`, errors);
    }
    if ((endpoint as any).accessPath !== undefined) {
        validateStringArray((endpoint as any).accessPath, `${path}.accessPath`, errors, { allowEmpty: false });
    }
}

function validateCallbackLocator(locator: unknown, path: string, errors: string[]): void {
    if (!isObject(locator)) {
        errors.push(`${path} must be a CallbackLocator`);
        return;
    }
    const kind = (locator as any).kind;
    requireOneOf(kind, ["arg", "option"], `${path}.kind`, errors);
    if (kind === "arg") {
        requireNonNegativeInteger((locator as any).index, `${path}.index`, errors);
    }
    if (kind === "option") {
        validateEndpoint((locator as any).base, `${path}.base`, errors);
        validateStringArray((locator as any).accessPath, `${path}.accessPath`, errors, { allowEmpty: false });
    }
}

function validateHandoffHandleTemplate(
    handle: unknown,
    path: string,
    errors: string[],
    options: NormalizedValidationOptions,
): void {
    if (!isObject(handle)) {
        errors.push(`${path} must be a HandoffHandleTemplate`);
        return;
    }
    if (typeof (handle as any).cellKind !== "string" || !options.cellKindRegistry.has((handle as any).cellKind)) {
        errors.push(`${path}.cellKind is not a registered CellKindId`);
    }
    requireStableString((handle as any).family, `${path}.family`, errors);
    validateHandlePartArray((handle as any).key, `${path}.key`, errors, { required: true });
    validateHandlePartArray((handle as any).scope, `${path}.scope`, errors, { required: false });
    validateHandlePartArray((handle as any).owner, `${path}.owner`, errors, { required: false });
    if ((handle as any).index !== undefined) requireNonNegativeInteger((handle as any).index, `${path}.index`, errors);
    requireOneOf((handle as any).precision, ["exact"], `${path}.precision`, errors);
}

function validateHandlePartArray(value: unknown, path: string, errors: string[], options: { required: boolean }): void {
    if (value === undefined) {
        if (options.required) errors.push(`${path} must be a non-empty HandleKeyPartTemplate[]`);
        return;
    }
    if (!Array.isArray(value) || value.length === 0) {
        errors.push(`${path} must be a non-empty HandleKeyPartTemplate[]`);
        return;
    }
    value.forEach((part, index) => validateHandlePartTemplate(part, `${path}[${index}]`, errors));
}

function validateHandlePartTemplate(part: unknown, path: string, errors: string[]): void {
    if (!isObject(part)) {
        errors.push(`${path} must be a HandleKeyPartTemplate`);
        return;
    }
    const kind = (part as any).kind;
    requireOneOf(kind, ["const", "fromEndpoint", "fromEndpointPath", "fromLiteralArg", "fromRouteTarget", "fromCallbackChannel", "unknown"], `${path}.kind`, errors);
    if (kind === "const") {
        requireString((part as any).value, `${path}.value`, errors);
    } else if (kind === "fromEndpoint") {
        validateEndpoint((part as any).endpoint, `${path}.endpoint`, errors);
    } else if (kind === "fromEndpointPath") {
        validateEndpoint((part as any).endpoint, `${path}.endpoint`, errors);
        validateStringArray((part as any).accessPath, `${path}.accessPath`, errors, { allowEmpty: false });
    } else if (kind === "fromLiteralArg") {
        requireNonNegativeInteger((part as any).index, `${path}.index`, errors);
    }
}

function validateRelation(relation: AssetRelation, path: string, surfaceIds: Set<string>, errors: string[]): void {
    if (!isObject(relation)) {
        errors.push(`${path} must be an object`);
        return;
    }
    requireString((relation as any).relationId, `${path}.relationId`, errors);
    if ((relation as any).kind !== "facade") {
        errors.push(`${path}.kind must be facade`);
        return;
    }
    requireString((relation as any).fromSurfaceId, `${path}.fromSurfaceId`, errors);
    if (typeof (relation as any).fromSurfaceId === "string" && !surfaceIds.has((relation as any).fromSurfaceId)) {
        errors.push(`${path}.fromSurfaceId references missing surface ${(relation as any).fromSurfaceId}`);
    }
    if (!isObject((relation as any).target)) errors.push(`${path}.target must be an object`);
    if (!isObject((relation as any).evidenceLocation)) errors.push(`${path}.evidenceLocation must be present`);
}

interface BindingValidationContext {
    assetPlane: unknown;
    identityRequired: boolean;
    surfaceIds: Set<string>;
    surfacesById: Map<string, AssetSurface>;
    templateIds: Set<string>;
    relationIds: Set<string>;
    templatesById: Map<string, SemanticEffectTemplate>;
    validationOptions: NormalizedValidationOptions;
    errors: string[];
}

function validateBinding(binding: AssetBinding, path: string, context: BindingValidationContext): void {
    const {
        assetPlane,
        identityRequired,
        surfaceIds,
        surfacesById,
        templateIds,
        relationIds,
        templatesById,
        validationOptions,
        errors,
    } = context;
    if (!isObject(binding)) {
        errors.push(`${path} must be an object`);
        return;
    }
    requireString((binding as any).bindingId, `${path}.bindingId`, errors);
    requireString((binding as any).surfaceId, `${path}.surfaceId`, errors);
    if (typeof (binding as any).surfaceId === "string" && !surfaceIds.has((binding as any).surfaceId)) {
        errors.push(`${path}.surfaceId references missing surface ${(binding as any).surfaceId}`);
    }
    requireString((binding as any).assetId, `${path}.assetId`, errors);
    requireOneOf((binding as any).plane, ["rule", "module", "arkmain"], `${path}.plane`, errors);
    if (
        (assetPlane === "rule" || assetPlane === "module" || assetPlane === "arkmain") &&
        typeof (binding as any).plane === "string" &&
        (binding as any).plane !== assetPlane
    ) {
        errors.push(`${path}.plane must match asset plane ${assetPlane}`);
    }
    requireOneOf((binding as any).role, ["source", "sink", "sanitizer", "transfer", "handoff", "module", "arkmain", "entry", "callback-registration"], `${path}.role`, errors);
    validateCanonicalApiIdField((binding as any).canonicalApiId, `${path}.canonicalApiId`, errors, { required: identityRequired });
    const surface = typeof (binding as any).surfaceId === "string"
        ? surfacesById.get((binding as any).surfaceId)
        : undefined;
    if (surface && isStableString((surface as any).canonicalApiId) && isStableString((binding as any).canonicalApiId)
        && (surface as any).canonicalApiId !== (binding as any).canonicalApiId) {
        errors.push(`${path}.canonicalApiId must match surface ${(binding as any).surfaceId} canonicalApiId`);
    }
    requireOneOf((binding as any).completeness, ["complete", "partial", "unknown"], `${path}.completeness`, errors);
    requireOneOf((binding as any).confidence, ["certain", "likely", "unknown"], `${path}.confidence`, errors);
    if ((binding as any).selector !== undefined) {
        errors.push(`${path}.selector is not an asset identity field; use canonicalApiId`);
    }
    if ((binding as any).endpoint !== undefined) {
        validateEndpoint((binding as any).endpoint, `${path}.endpoint`, errors);
        if ((binding as any).role === "sink") {
            validateSinkEndpoint((binding as any).endpoint, `${path}.endpoint`, errors);
        }
    }
    const descriptor = isStableString((binding as any).canonicalApiId)
        ? validationOptions.resolveCanonicalApiDescriptor((binding as any).canonicalApiId)
        : undefined;
    if (descriptor) {
        if ((binding as any).endpoint !== undefined) {
            validateEndpointProjectability((binding as any).endpoint, descriptor, `${path}.endpoint`, errors);
        }
        if (Array.isArray((binding as any).effectTemplateRefs)) {
            for (const ref of (binding as any).effectTemplateRefs) {
                const template = templatesById.get(ref);
                validateTemplateEndpointProjectability(template, descriptor, `effectTemplate ${ref}`, errors);
            }
        }
    }
    if (Array.isArray((binding as any).effectTemplateRefs)) {
        for (const ref of (binding as any).effectTemplateRefs) {
            if (!templateIds.has(ref)) errors.push(`${path}.effectTemplateRefs references missing template ${ref}`);
        }
    }
    if (Array.isArray((binding as any).relationRefs)) {
        for (const ref of (binding as any).relationRefs) {
            if (!relationIds.has(ref)) errors.push(`${path}.relationRefs references missing relation ${ref}`);
        }
    }
}

function validateConstructSurfaceEndpointCompatibility(
    surfacesById: Map<string, AssetSurface>,
    bindings: AssetBinding[],
    templatesById: Map<string, SemanticEffectTemplate>,
    errors: string[],
): void {
    bindings.forEach((binding, bindingIndex) => {
        if (!isObject(binding)) return;
        const surface = surfacesById.get((binding as any).surfaceId);
        if (!surface || (surface as any).kind !== "construct") return;
        rejectReceiverEndpointOnConstruct((binding as any).endpoint, `$.bindings[${bindingIndex}].endpoint`, errors);
        if (!Array.isArray((binding as any).effectTemplateRefs)) return;
        for (const ref of (binding as any).effectTemplateRefs) {
            const template = templatesById.get(ref);
            if (!template || !isObject(template)) continue;
            const templatePath = `effectTemplate ${ref}`;
            rejectReceiverEndpointOnConstruct((template as any).value, `${templatePath}.value`, errors);
            rejectReceiverEndpointOnConstruct((template as any).from, `${templatePath}.from`, errors);
            rejectReceiverEndpointOnConstruct((template as any).to, `${templatePath}.to`, errors);
            rejectReceiverEndpointOnConstruct((template as any).target, `${templatePath}.target`, errors);
        }
    });
}

function rejectReceiverEndpointOnConstruct(endpoint: unknown, path: string, errors: string[]): void {
    if (!isObject(endpoint) || !isObject((endpoint as any).base)) return;
    if ((endpoint as any).base.kind === "receiver") {
        errors.push(`${path} must not use receiver on a construct surface; use arg for constructor inputs or constructorResult for constructed-object fields`);
    }
}

function validateSinkEndpoint(value: unknown, path: string, errors: string[]): void {
    const endpoint = normalizeRuleEndpoint(value);
    if (!endpoint || !isObject((endpoint as any).base)) return;
    const kind = String((endpoint as any).base.kind || "");
    if (kind === "return" || kind === "promiseResult" || kind === "promiseRejected" || kind === "constructorResult" || kind === "callbackReturn") {
        errors.push(`${path} for rule.sink must be a consumed input endpoint, not ${kind}`);
    }
}

function normalizeRuleEndpoint(value: unknown): unknown {
    if (!isObject(value)) return undefined;
    if (isObject((value as any).endpoint)) return (value as any).endpoint;
    return value;
}

function collectForbiddenFields(value: unknown, path: string, errors: string[]): void {
    if (!isObject(value)) return;
    if (isSupportedArkanalyzerEvidencePath(path)) return;
    for (const [key, child] of Object.entries(value)) {
        const childPath = `${path}.${key}`;
        if (forbiddenKeys.has(key)) {
            errors.push(`${childPath} is a forbidden legacy field`);
        }
        if (key === "semantics" && isObject(child) && Array.isArray((child as any).effects)) {
            errors.push(`${childPath}.effects is a forbidden legacy field`);
        }
        if (Array.isArray(child)) {
            child.forEach((item, index) => collectForbiddenFields(item, `${childPath}[${index}]`, errors));
        } else {
            collectForbiddenFields(child, childPath, errors);
        }
    }
}

function isSupportedArkanalyzerEvidencePath(path: string): boolean {
    return /^\$\.surfaces\[\d+\]\.evidence\.arkanalyzer\.methodKey(?:\.|$)/.test(path);
}

function requireString(value: unknown, path: string, errors: string[]): void {
    if (typeof value !== "string" || value.length === 0) {
        errors.push(`${path} must be a non-empty string`);
    }
}

function requireStableString(value: unknown, path: string, errors: string[]): void {
    if (!isStableString(value)) {
        errors.push(`${path} must be a stable non-empty string`);
    }
}

function validateCanonicalApiIdField(
    value: unknown,
    path: string,
    errors: string[],
    options: { required: boolean },
): void {
    if (value === undefined) {
        if (options.required) {
            errors.push(`${path} is required for trusted assets`);
        }
        return;
    }
    if (!isStableString(value)) {
        errors.push(`${path} must be a stable canonicalApiId`);
        return;
    }
    try {
        assertValidCanonicalApiId(value);
    } catch (error) {
        errors.push(`${path} ${error instanceof Error ? error.message : String(error)}`);
    }
}

function requireNonNegativeInteger(value: unknown, path: string, errors: string[]): void {
    if (!Number.isInteger(value) || Number(value) < 0) {
        errors.push(`${path} must be a non-negative integer`);
    }
}

function validateInteger(value: unknown, path: string, errors: string[], options: { min: number }): void {
    if (!Number.isInteger(value) || Number(value) < options.min) {
        errors.push(`${path} must be an integer >= ${options.min}`);
    }
}

function validateIntegerArray(
    value: unknown,
    path: string,
    errors: string[],
    options: { min: number; allowEmpty: boolean },
): void {
    if (!Array.isArray(value) || (!options.allowEmpty && value.length === 0)) {
        errors.push(`${path} must be a ${options.allowEmpty ? "" : "non-empty "}integer[]`);
        return;
    }
    value.forEach((item, index) => validateInteger(item, `${path}[${index}]`, errors, { min: options.min }));
}

function validateStringArray(
    value: unknown,
    path: string,
    errors: string[],
    options: { allowEmpty: boolean },
): void {
    if (!Array.isArray(value) || (!options.allowEmpty && value.length === 0)) {
        errors.push(`${path} must be a ${options.allowEmpty ? "" : "non-empty "}string[]`);
        return;
    }
    value.forEach((item, index) => requireString(item, `${path}[${index}]`, errors));
}

function requireOneOf(value: unknown, allowed: readonly string[], path: string, errors: string[]): void {
    if (typeof value !== "string" || !allowed.includes(value)) {
        errors.push(`${path} must be one of ${allowed.join(", ")}`);
    }
}

function isStableString(value: unknown): value is string {
    if (typeof value !== "string") return false;
    const text = value.trim();
    if (!text) return false;
    return !text.includes("%unk") && !text.includes("@unk");
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
