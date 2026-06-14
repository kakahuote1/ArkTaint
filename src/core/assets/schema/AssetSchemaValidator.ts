import type { AssetDocumentBase } from "./AssetTypes";
import type { AssetBinding } from "./BindingTypes";
import { result, type ValidationResult } from "./CommonTypes";
import type { SemanticEffectTemplate } from "./EffectTemplateTypes";
import { SEMANTIC_EFFECT_KINDS } from "./EffectTemplateTypes";
import type { AssetRelation } from "./RelationTypes";
import type { RuntimeSelector, RuntimeSelectorScope, SelectorStringConstraint } from "./SelectorTypes";
import type { AssetSurface, InvokeSurface } from "./SurfaceTypes";
import { DEFAULT_CELL_KIND_REGISTRY, type CellKindRegistry } from "../../cellkind";

const trustedStatuses = new Set(["official", "reviewed", "replayed"]);
const forbiddenKeys = new Set([
    "schemaVersion",
    "modelVersion",
    "assetVersion",
    "semanticsRef",
    "coverageSurfaces",
    "ValueEndpoint",
    "ModelStatus",
]);

export interface AssetDocumentValidationOptions {
    cellKindRegistry?: Pick<CellKindRegistry, "has">;
}

interface NormalizedValidationOptions {
    cellKindRegistry: Pick<CellKindRegistry, "has">;
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

    if (typeof doc.status === "string" && trustedStatuses.has(doc.status)) {
        if (surfaces.length === 0) errors.push(`trusted asset ${doc.id || "<unknown>"} must declare at least one surface`);
        if (bindings.length === 0) errors.push(`trusted asset ${doc.id || "<unknown>"} must declare at least one binding`);
    }

    const surfaceIds = new Set<string>();
    const surfacesById = new Map<string, AssetSurface>();
    surfaces.forEach((surface, index) => {
        validateSurface(surface as AssetSurface, `$.surfaces[${index}]`, errors);
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
        validateBinding(binding as AssetBinding, `$.bindings[${index}]`, doc.plane, surfaceIds, templateIds, relationIds, errors);
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
    if ((surface as any).kind !== "invoke") return undefined;
    const modulePath = String((surface as any).modulePath || "");
    const owner = String((surface as any).ownerName || (surface as any).functionName || "");
    if (!modulePath || !owner) return undefined;
    return `${modulePath}::${owner}`;
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
    return {
        cellKindRegistry: options.cellKindRegistry || DEFAULT_CELL_KIND_REGISTRY,
    };
}

function validateSurface(surface: AssetSurface, path: string, errors: string[]): void {
    if (!isObject(surface)) {
        errors.push(`${path} must be an object`);
        return;
    }
    requireString((surface as any).surfaceId, `${path}.surfaceId`, errors);
    requireOneOf((surface as any).confidence, ["certain", "likely", "unknown"], `${path}.confidence`, errors);
    if (!isObject((surface as any).provenance)) errors.push(`${path}.provenance must be an object`);
    switch ((surface as any).kind) {
        case "invoke":
            validateInvokeSurface(surface as InvokeSurface, path, errors);
            break;
        case "construct":
            requireStableString((surface as any).modulePath, `${path}.modulePath`, errors);
            requireStableString((surface as any).className, `${path}.className`, errors);
            requireNonNegativeInteger((surface as any).argCount, `${path}.argCount`, errors);
            break;
        case "access":
            requireStableString((surface as any).modulePath, `${path}.modulePath`, errors);
            requireStableString((surface as any).ownerName, `${path}.ownerName`, errors);
            requireStableString((surface as any).propertyName, `${path}.propertyName`, errors);
            requireOneOf((surface as any).accessKind, ["read", "write", "getter", "setter"], `${path}.accessKind`, errors);
            requireOneOf((surface as any).receiverKind, ["instance", "static", "namespace"], `${path}.receiverKind`, errors);
            break;
        case "entry":
            requireStableString((surface as any).ownerName, `${path}.ownerName`, errors);
            requireStableString((surface as any).methodName, `${path}.methodName`, errors);
            requireStableString((surface as any).phase, `${path}.phase`, errors);
            requireStableString((surface as any).entryKind, `${path}.entryKind`, errors);
            break;
        case "callback":
            if (!isObject((surface as any).registrar)) errors.push(`${path}.registrar must be an InvokeSurface`);
            if (!isObject((surface as any).callback)) errors.push(`${path}.callback must be a CallbackLocator`);
            break;
        case "decorator":
            requireStableString((surface as any).decoratorName, `${path}.decoratorName`, errors);
            requireStableString((surface as any).ownerName, `${path}.ownerName`, errors);
            requireOneOf((surface as any).ownerKind, ["class", "field", "method", "component"], `${path}.ownerKind`, errors);
            break;
        default:
            errors.push(`${path}.kind is not a registered AssetSurface kind`);
    }
}

function validateInvokeSurface(surface: InvokeSurface, path: string, errors: string[]): void {
    requireStableString(surface.modulePath, `${path}.modulePath`, errors);
    requireOneOf(surface.invokeKind, ["instance", "static", "namespace", "free-function"], `${path}.invokeKind`, errors);
    requireNonNegativeInteger(surface.argCount, `${path}.argCount`, errors);
    if (surface.invokeKind === "instance" || surface.invokeKind === "static") {
        requireStableString(surface.ownerName, `${path}.ownerName`, errors);
        requireStableString(surface.methodName, `${path}.methodName`, errors);
        return;
    }
    if (surface.invokeKind === "free-function") {
        requireStableString(surface.functionName, `${path}.functionName`, errors);
        return;
    }
    if (surface.invokeKind === "namespace" && !isStableString(surface.ownerName) && !isStableString(surface.functionName)) {
        errors.push(`${path}.ownerName or ${path}.functionName is required for namespace invoke`);
    }
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
    if (template.onMethods !== undefined) {
        validateStringArray(template.onMethods, `${path}.onMethods`, errors, { allowEmpty: false });
    }
    if (template.emitMethods !== undefined) {
        validateStringArray(template.emitMethods, `${path}.emitMethods`, errors, { allowEmpty: false });
    }
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
        requireOneOf(value, ["strong", "weak", "infer"], path, errors);
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
        if ((value as any).taintScope !== undefined) {
            requireOneOf((value as any).taintScope, ["self", "contained-values"], `${path}.taintScope`, errors);
        }
        return;
    }
    validateEndpoint(value, path, errors);
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
    requireOneOf(kind, ["receiver", "arg", "return", "callbackArg", "callbackReturn", "promiseResult", "constructorResult"], `${path}.base.kind`, errors);
    if (kind === "arg") {
        requireNonNegativeInteger((base as any).index, `${path}.base.index`, errors);
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
    requireOneOf((handle as any).precision, ["infer", "exact", "partial", "unknown"], `${path}.precision`, errors);
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

function validateBinding(
    binding: AssetBinding,
    path: string,
    assetPlane: unknown,
    surfaceIds: Set<string>,
    templateIds: Set<string>,
    relationIds: Set<string>,
    errors: string[],
): void {
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
    requireOneOf((binding as any).role, ["source", "sink", "sanitizer", "transfer", "handoff", "entry", "callback-registration"], `${path}.role`, errors);
    requireOneOf((binding as any).completeness, ["complete", "partial", "unknown"], `${path}.completeness`, errors);
    requireOneOf((binding as any).confidence, ["certain", "likely", "unknown"], `${path}.confidence`, errors);
    if ((binding as any).selector !== undefined) {
        validateRuntimeSelector((binding as any).selector, `${path}.selector`, errors);
    }
    if ((binding as any).endpoint !== undefined) {
        validateEndpoint((binding as any).endpoint, `${path}.endpoint`, errors);
        if ((binding as any).role === "sink") {
            validateSinkEndpoint((binding as any).endpoint, `${path}.endpoint`, errors);
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
    if (kind === "return" || kind === "promiseResult" || kind === "constructorResult" || kind === "callbackReturn") {
        errors.push(`${path} for rule.sink must be a consumed input endpoint, not ${kind}`);
    }
}

function normalizeRuleEndpoint(value: unknown): unknown {
    if (!isObject(value)) return undefined;
    if (isObject((value as any).endpoint)) return (value as any).endpoint;
    return value;
}

function validateRuntimeSelector(selector: RuntimeSelector, path: string, errors: string[]): void {
    if (!isObject(selector)) {
        errors.push(`${path} must be an object`);
        return;
    }
    requireOneOf(
        (selector as any).kind,
        [
            "signature-contains",
            "signature-equals",
            "signature-regex",
            "declaring-class-equals",
            "method-name-equals",
            "method-name-regex",
            "local-name-regex",
        ],
        `${path}.kind`,
        errors,
    );
    requireString((selector as any).value, `${path}.value`, errors);
    if (typeof (selector as any).kind === "string" && String((selector as any).kind).endsWith("regex")) {
        validateRegex((selector as any).value, `${path}.value`, errors);
    }
    if ((selector as any).invokeKind !== undefined) {
        requireOneOf((selector as any).invokeKind, ["any", "instance", "static"], `${path}.invokeKind`, errors);
    }
    if ((selector as any).argCount !== undefined) {
        requireNonNegativeInteger((selector as any).argCount, `${path}.argCount`, errors);
    }
    if ((selector as any).typeHint !== undefined) {
        requireString((selector as any).typeHint, `${path}.typeHint`, errors);
    }
    if ((selector as any).calleeClass !== undefined) {
        validateSelectorStringConstraint((selector as any).calleeClass, `${path}.calleeClass`, errors);
    }
    if ((selector as any).scope !== undefined) {
        validateRuntimeSelectorScope((selector as any).scope, `${path}.scope`, errors);
    }
    if ((selector as any).calleeScope !== undefined) {
        validateRuntimeSelectorScope((selector as any).calleeScope, `${path}.calleeScope`, errors);
    }
}

function validateRuntimeSelectorScope(scope: RuntimeSelectorScope, path: string, errors: string[]): void {
    if (!isObject(scope)) {
        errors.push(`${path} must be an object`);
        return;
    }
    for (const fieldName of ["file", "module", "className", "methodName"] as const) {
        const raw = (scope as any)[fieldName];
        if (raw !== undefined) {
            validateSelectorStringConstraint(raw, `${path}.${fieldName}`, errors);
        }
    }
    const methodDecorators = (scope as any).methodDecorators;
    if (methodDecorators !== undefined) {
        if (!Array.isArray(methodDecorators) || methodDecorators.length === 0) {
            errors.push(`${path}.methodDecorators must be a non-empty array`);
        } else {
            methodDecorators.forEach((raw, index) => {
                validateSelectorStringConstraint(raw, `${path}.methodDecorators[${index}]`, errors);
            });
        }
    }
}

function validateSelectorStringConstraint(raw: SelectorStringConstraint, path: string, errors: string[]): void {
    if (!isObject(raw)) {
        errors.push(`${path} must be an object`);
        return;
    }
    requireOneOf((raw as any).mode, ["equals", "contains", "regex"], `${path}.mode`, errors);
    requireString((raw as any).value, `${path}.value`, errors);
    if ((raw as any).mode === "regex") {
        validateRegex((raw as any).value, `${path}.value`, errors);
    }
}

function collectForbiddenFields(value: unknown, path: string, errors: string[]): void {
    if (!isObject(value)) return;
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

function validateRegex(value: unknown, path: string, errors: string[]): void {
    if (typeof value !== "string") return;
    try {
        // eslint-disable-next-line no-new
        new RegExp(value);
    } catch (error: any) {
        errors.push(`${path} regex is invalid: ${String(error?.message || error)}`);
    }
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
