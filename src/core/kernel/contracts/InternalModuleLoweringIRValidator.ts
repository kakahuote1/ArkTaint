import type {
    ModuleAddress,
    ModuleBridgeEmitSpec,
    ModuleConstraint,
    ModuleDispatch,
    ModuleEndpoint,
    ModuleFieldPathPart,
    ModuleFieldPathSpec,
    ModuleSemantic,
    ModuleSemanticSurfaceRef,
    InternalModuleLoweringIR,
} from "./InternalModuleLoweringIR";

const VALID_SEMANTIC_KINDS = new Set([
    "bridge",
    "state",
    "declarative_binding",
    "handoff_effect",
    "container",
    "ability_handoff",
    "keyed_storage",
    "event_emitter",
    "route_bridge",
    "state_binding",
]);

const VALID_ENDPOINT_SLOTS = new Set([
    "arg",
    "base",
    "result",
    "callback_param",
    "method_this",
    "method_param",
    "field_load",
    "decorated_field_value",
]);

const VALID_SURFACE_KINDS = new Set([
    "invoke",
    "method",
    "decorated_field",
]);

const VALID_FIELD_PATH_PART_KINDS = new Set([
    "literal",
    "current_field",
    "current_tail",
    "current_field_without_prefix",
]);

const VALID_DISPATCH_PRESETS = new Set([
    "callback_sync",
    "callback_event",
    "promise_fulfilled",
    "promise_rejected",
    "promise_any",
    "declarative_field",
]);

const VALID_TRANSFER_MODES = new Set([
    "preserve",
    "plain",
    "current_field_tail",
]);

const VALID_BOUNDARY_KINDS = new Set([
    "identity",
    "serialized_copy",
    "clone_copy",
    "stringify_result",
]);

const VALID_HANDOFF_EFFECT_KINDS = new Set([
    "put",
    "get",
    "kill",
]);

const VALID_KEYED_STORAGE_UPDATE_STRENGTHS = new Set([
    "strong",
    "weak",
]);

const VALID_CONTAINER_FAMILIES = new Set([
    "array",
    "map",
    "weakmap",
    "set",
    "weakset",
    "list",
    "queue",
    "stack",
    "resultset",
]);

const VALID_CONTAINER_CAPABILITIES = new Set([
    "store",
    "nested_store",
    "mutation_base",
    "load",
    "view",
    "object_from_entries",
    "promise_aggregate",
    "resultset",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function formatValue(value: unknown): string {
    if (typeof value === "string") {
        return `"${value}"`;
    }
    if (value === undefined) {
        return "undefined";
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

class ValidationCollector {
    private readonly issues: string[] = [];

    add(path: string, message: string, got?: unknown): void {
        if (got === undefined) {
            this.issues.push(`${path} ${message}`);
            return;
        }
        this.issues.push(`${path} ${message}. Got: ${formatValue(got)}`);
    }

    get hasIssues(): boolean {
        return this.issues.length > 0;
    }

    toArray(): string[] {
        return [...this.issues];
    }
}

export class InternalModuleLoweringIRValidationError extends Error {
    readonly specId?: string;
    readonly issues: string[];

    constructor(specId: string | undefined, issues: string[]) {
        const title = specId && specId.trim().length > 0
            ? `Invalid InternalModuleLoweringIR "${specId}"`
            : "Invalid InternalModuleLoweringIR";
        super(`${title}:\n${issues.map(issue => `  - ${issue}`).join("\n")}`);
        this.name = "InternalModuleLoweringIRValidationError";
        this.specId = specId;
        this.issues = issues;
    }
}

function validateString(value: unknown, path: string, collector: ValidationCollector, options?: {
    allowEmpty?: boolean;
}): value is string {
    if (typeof value !== "string") {
        collector.add(path, "must be a string", value);
        return false;
    }
    if (options?.allowEmpty !== true && value.trim().length === 0) {
        collector.add(path, "must be a non-empty string", value);
        return false;
    }
    return true;
}

function validateBoolean(value: unknown, path: string, collector: ValidationCollector): value is boolean {
    if (typeof value !== "boolean") {
        collector.add(path, "must be a boolean", value);
        return false;
    }
    return true;
}

function validateInteger(value: unknown, path: string, collector: ValidationCollector, options?: {
    allowZero?: boolean;
}): value is number {
    if (!Number.isInteger(value)) {
        collector.add(path, "must be an integer", value);
        return false;
    }
    if ((value as number) < 0 || (options?.allowZero === false && (value as number) === 0)) {
        collector.add(path, "must be a non-negative integer", value);
        return false;
    }
    return true;
}

function validateEventEmitterPayloadArgIndex(value: unknown, path: string, collector: ValidationCollector): value is number {
    if (!Number.isInteger(value)) {
        collector.add(path, "must be an integer", value);
        return false;
    }
    if ((value as number) < -1) {
        collector.add(path, "must be -1 for no-payload dispatch or a non-negative integer", value);
        return false;
    }
    return true;
}

function validateStringArray(value: unknown, path: string, collector: ValidationCollector): value is string[] {
    if (!Array.isArray(value)) {
        collector.add(path, "must be an array", value);
        return false;
    }
    let ok = true;
    value.forEach((item, index) => {
        ok = validateString(item, `${path}[${index}]`, collector) && ok;
    });
    return ok;
}

function validateStringEnum(
    value: unknown,
    allowed: Set<string>,
    path: string,
    collector: ValidationCollector,
): value is string {
    if (typeof value !== "string" || !allowed.has(value)) {
        collector.add(path, `must be one of: ${[...allowed.values()].map(item => `"${item}"`).join(", ")}`, value);
        return false;
    }
    return true;
}

function validateFieldPathPart(value: unknown, path: string, collector: ValidationCollector): value is ModuleFieldPathPart {
    if (!isRecord(value)) {
        collector.add(path, "must be an object", value);
        return false;
    }
    if (!validateStringEnum(value.kind, VALID_FIELD_PATH_PART_KINDS, `${path}.kind`, collector)) {
        return false;
    }
    switch (value.kind) {
        case "literal":
            validateString(value.value, `${path}.value`, collector);
            return true;
        case "current_field":
        case "current_tail":
            return true;
        case "current_field_without_prefix":
            if (!Array.isArray(value.prefixes)) {
                collector.add(`${path}.prefixes`, "must be an array of string arrays", value.prefixes);
                return false;
            }
            value.prefixes.forEach((prefix, index) => {
                validateStringArray(prefix, `${path}.prefixes[${index}]`, collector);
            });
            return true;
    }
}

function validateFieldPathSpec(value: unknown, path: string, collector: ValidationCollector): value is ModuleFieldPathSpec {
    if (value === undefined) {
        return true;
    }
    if (Array.isArray(value)) {
        return validateStringArray(value, path, collector);
    }
    if (!isRecord(value)) {
        collector.add(path, "must be a string[] or field-path template object", value);
        return false;
    }
    if (!Array.isArray(value.parts)) {
        collector.add(`${path}.parts`, "must be an array", value.parts);
        return false;
    }
    value.parts.forEach((part, index) => validateFieldPathPart(part, `${path}.parts[${index}]`, collector));
    return true;
}

function validateInvokeSelector(value: Record<string, unknown>, path: string, collector: ValidationCollector): void {
    validateStringEnum(value.surfaceKind, new Set(["invoke"]), `${path}.surfaceKind`, collector);
    validateString(value.canonicalApiId, `${path}.canonicalApiId`, collector);
    rejectLegacyCallSelectorFields(value, path, collector);
}

function validateConstructSelector(value: Record<string, unknown>, path: string, collector: ValidationCollector): void {
    validateStringEnum(value.surfaceKind, new Set(["construct"]), `${path}.surfaceKind`, collector);
    validateString(value.canonicalApiId, `${path}.canonicalApiId`, collector);
    rejectLegacyCallSelectorFields(value, path, collector);
}

function validateCallSurfaceSelector(value: Record<string, unknown>, path: string, collector: ValidationCollector): void {
    if (value.surfaceKind === "construct") {
        validateConstructSelector(value, path, collector);
        return;
    }
    validateInvokeSelector(value, path, collector);
}

function rejectLegacyCallSelectorFields(
    value: Record<string, unknown>,
    path: string,
    collector: ValidationCollector,
): void {
    for (const fieldName of [
        "canonicalApiIds",
        "modulePath",
        "methodName",
        "declaringClassName",
        "baseLocalName",
        "baseLocalNames",
        "signature",
        "argCount",
        "instanceOnly",
        "staticOnly",
        "className",
        "declaringClassIncludes",
        "signatureIncludes",
        "minArgs",
    ]) {
        rejectUnsupportedSelectorField(value, fieldName, path, collector);
    }
}

function validateMethodSelector(value: Record<string, unknown>, path: string, collector: ValidationCollector): void {
    validateString(value.methodSignature, `${path}.methodSignature`, collector);
    rejectUnsupportedSelectorField(value, "methodName", path, collector);
    rejectUnsupportedSelectorField(value, "declaringClassName", path, collector);
    rejectUnsupportedSelectorField(value, "declaringClassIncludes", path, collector);
}

function validateDecoratedFieldSelector(value: Record<string, unknown>, path: string, collector: ValidationCollector): void {
    if (value.className !== undefined) validateString(value.className, `${path}.className`, collector);
    rejectUnsupportedSelectorField(value, "classNameIncludes", path, collector);
    if (value.fieldName !== undefined) validateString(value.fieldName, `${path}.fieldName`, collector);
    if (value.fieldSignature !== undefined) validateString(value.fieldSignature, `${path}.fieldSignature`, collector);
    validateDecoratorCanonicalSelector(value, path, collector);
    rejectUnsupportedSelectorField(value, "decoratorKind", path, collector);
    rejectUnsupportedSelectorField(value, "decoratorKinds", path, collector);
    rejectUnsupportedSelectorField(value, "decoratorParam", path, collector);
    rejectUnsupportedSelectorField(value, "decoratorParams", path, collector);
}

function validateDecoratorCanonicalSelector(
    value: Record<string, unknown>,
    path: string,
    collector: ValidationCollector,
): void {
    let hasSelector = false;
    if (value.decoratorCanonicalApiId !== undefined) {
        hasSelector = validateString(value.decoratorCanonicalApiId, `${path}.decoratorCanonicalApiId`, collector) || hasSelector;
    }
    if (value.decoratorCanonicalApiIds !== undefined) {
        if (validateStringArray(value.decoratorCanonicalApiIds, `${path}.decoratorCanonicalApiIds`, collector)
            && (value.decoratorCanonicalApiIds as string[]).length > 0) {
            hasSelector = true;
        } else if (Array.isArray(value.decoratorCanonicalApiIds) && value.decoratorCanonicalApiIds.length === 0) {
            collector.add(`${path}.decoratorCanonicalApiIds`, "must contain at least one accepted decorator canonicalApiId", value.decoratorCanonicalApiIds);
        }
    }
    if (!hasSelector) {
        collector.add(path, "must include decoratorCanonicalApiId or decoratorCanonicalApiIds from accepted decorator occurrences");
    }
}

function rejectUnsupportedSelectorField(
    value: Record<string, unknown>,
    fieldName: string,
    path: string,
    collector: ValidationCollector,
): void {
    if (value[fieldName] === undefined) return;
    collector.add(
        `${path}.${fieldName}`,
        "is not supported in formal module assets; use exact API identity fields",
        value[fieldName],
    );
}

function validateSurfaceRef(value: unknown, path: string, collector: ValidationCollector): boolean {
    if (typeof value === "string") {
        collector.add(path, "must reference an exact surface object, not a legacy string selector", value);
        return false;
    }
    if (!isRecord(value)) {
        collector.add(path, "must be an object", value);
        return false;
    }
    if (!validateStringEnum(value.kind, VALID_SURFACE_KINDS, `${path}.kind`, collector)) {
        return false;
    }
    if (!isRecord(value.selector)) {
        collector.add(`${path}.selector`, "must be an object", value.selector);
        return false;
    }
    switch (value.kind) {
        case "invoke":
            validateInvokeSelector(value.selector, `${path}.selector`, collector);
            return true;
        case "method":
            validateMethodSelector(value.selector, `${path}.selector`, collector);
            return true;
        case "decorated_field":
            validateDecoratedFieldSelector(value.selector, `${path}.selector`, collector);
            return true;
    }
}

function isInvokeSurfaceLike(value: unknown): boolean {
    return typeof value === "string" || (isRecord(value) && value.kind === "invoke");
}

function isMethodSurfaceLike(value: unknown): boolean {
    return isRecord(value) && value.kind === "method";
}

function isDecoratedFieldSurfaceLike(value: unknown): boolean {
    return isRecord(value) && value.kind === "decorated_field";
}

function validateEndpoint(value: unknown, path: string, collector: ValidationCollector): value is ModuleEndpoint {
    if (!isRecord(value)) {
        collector.add(path, "must be an object", value);
        return false;
    }
    const hasSurface = validateSurfaceRef(value.surface, `${path}.surface`, collector);
    const hasSlot = validateStringEnum(value.slot, VALID_ENDPOINT_SLOTS, `${path}.slot`, collector);
    validateFieldPathSpec(value.fieldPath, `${path}.fieldPath`, collector);
    if (!hasSurface || !hasSlot) {
        return false;
    }
    switch (value.slot) {
        case "arg":
            validateInteger(value.index, `${path}.index`, collector);
            if (value.rest !== undefined) validateBoolean(value.rest, `${path}.rest`, collector);
            if (!isInvokeSurfaceLike(value.surface)) {
                collector.add(`${path}.surface.kind`, "must be \"invoke\" when slot is \"arg\"", isRecord(value.surface) ? value.surface.kind : value.surface);
            }
            return true;
        case "base":
        case "result":
            if (!isInvokeSurfaceLike(value.surface)) {
                collector.add(`${path}.surface.kind`, `must be "invoke" when slot is "${value.slot}"`, isRecord(value.surface) ? value.surface.kind : value.surface);
            }
            return true;
        case "callback_param":
            if (value.callbackArgIndex !== undefined) validateInteger(value.callbackArgIndex, `${path}.callbackArgIndex`, collector);
            if (value.paramIndex !== undefined) validateInteger(value.paramIndex, `${path}.paramIndex`, collector);
            if (value.rest !== undefined) validateBoolean(value.rest, `${path}.rest`, collector);
            if (!isInvokeSurfaceLike(value.surface)) {
                collector.add(`${path}.surface.kind`, "must be \"invoke\" when slot is \"callback_param\"", isRecord(value.surface) ? value.surface.kind : value.surface);
            }
            return true;
        case "method_this":
            if (!isMethodSurfaceLike(value.surface)) {
                collector.add(`${path}.surface.kind`, "must be \"method\" when slot is \"method_this\"", isRecord(value.surface) ? value.surface.kind : value.surface);
            }
            return true;
        case "method_param":
            validateInteger(value.paramIndex, `${path}.paramIndex`, collector);
            if (!isMethodSurfaceLike(value.surface)) {
                collector.add(`${path}.surface.kind`, "must be \"method\" when slot is \"method_param\"", isRecord(value.surface) ? value.surface.kind : value.surface);
            }
            return true;
        case "field_load":
            validateString(value.fieldName, `${path}.fieldName`, collector);
            if (value.baseThisOnly !== undefined) validateBoolean(value.baseThisOnly, `${path}.baseThisOnly`, collector);
            if (!isMethodSurfaceLike(value.surface)) {
                collector.add(`${path}.surface.kind`, "must be \"method\" when slot is \"field_load\"", isRecord(value.surface) ? value.surface.kind : value.surface);
            }
            return true;
        case "decorated_field_value":
            if (!isDecoratedFieldSurfaceLike(value.surface)) {
                collector.add(`${path}.surface.kind`, "must be \"decorated_field\" when slot is \"decorated_field_value\"", isRecord(value.surface) ? value.surface.kind : value.surface);
            }
            return true;
    }
}

function validateAssetEndpointLike(value: unknown, path: string, collector: ValidationCollector): void {
    if (!isRecord(value)) {
        collector.add(path, "must be an object", value);
        return;
    }
    if (!isRecord(value.base)) {
        collector.add(`${path}.base`, "must be an object", value.base);
        return;
    }
    validateString(value.base.kind, `${path}.base.kind`, collector);
    if (value.accessPath !== undefined) {
        validateStringArray(value.accessPath, `${path}.accessPath`, collector);
    }
}

function validateHandoffHandleLike(value: unknown, path: string, collector: ValidationCollector): void {
    if (!isRecord(value)) {
        collector.add(path, "must be an object", value);
        return;
    }
    validateString(value.cellKind, `${path}.cellKind`, collector);
    validateString(value.family, `${path}.family`, collector);
    if (!Array.isArray(value.key)) {
        collector.add(`${path}.key`, "must be an array", value.key);
    }
    if (value.scope !== undefined && !Array.isArray(value.scope)) {
        collector.add(`${path}.scope`, "must be an array", value.scope);
    }
    if (value.owner !== undefined && !Array.isArray(value.owner)) {
        collector.add(`${path}.owner`, "must be an array", value.owner);
    }
}

function validateHandoffEffectSpec(value: unknown, path: string, collector: ValidationCollector): void {
    if (!isRecord(value)) {
        collector.add(path, "must be an object", value);
        return;
    }
    validateString(value.id, `${path}.id`, collector);
    validateStringEnum(value.effectKind, VALID_HANDOFF_EFFECT_KINDS, `${path}.effectKind`, collector);
    if (!isRecord(value.surface)) {
        collector.add(`${path}.surface`, "must be an object", value.surface);
    } else {
        validateCallSurfaceSelector(value.surface, `${path}.surface`, collector);
    }
    validateHandoffHandleLike(value.handle, `${path}.handle`, collector);
    if (value.value !== undefined) validateAssetEndpointLike(value.value, `${path}.value`, collector);
    if (value.target !== undefined) validateAssetEndpointLike(value.target, `${path}.target`, collector);
}

function validateAddress(value: unknown, path: string, collector: ValidationCollector): value is ModuleAddress {
    if (!isRecord(value)) {
        collector.add(path, "must be an object", value);
        return false;
    }
    if (!validateString(value.kind, `${path}.kind`, collector)) {
        return false;
    }
    switch (value.kind) {
        case "literal":
            validateString(value.value, `${path}.value`, collector);
            return true;
        case "endpoint":
            validateEndpoint(value.endpoint, `${path}.endpoint`, collector);
            return true;
        case "decorated_field_meta":
            if (!isRecord(value.surface)) {
                collector.add(`${path}.surface`, "must be an object", value.surface);
                return false;
            }
            validateDecoratedFieldSelector(value.surface, `${path}.surface`, collector);
            validateStringEnum(value.source, new Set([
                "field_name",
                "decorator_param",
                "decorator_param_or_field_name",
            ]), `${path}.source`, collector);
            rejectUnsupportedSelectorField(value, "decoratorKind", path, collector);
            return true;
        default:
            collector.add(`${path}.kind`, "must be one of: \"literal\", \"endpoint\", \"decorated_field_meta\"", value.kind);
            return false;
    }
}

function validateDispatch(value: unknown, path: string, collector: ValidationCollector): value is ModuleDispatch {
    if (!isRecord(value)) {
        collector.add(path, "must be an object", value);
        return false;
    }
    validateStringEnum(value.preset, VALID_DISPATCH_PRESETS, `${path}.preset`, collector);
    if (value.via !== undefined) validateEndpoint(value.via, `${path}.via`, collector);
    if (value.reason !== undefined) validateString(value.reason, `${path}.reason`, collector);
    if (value.semantics !== undefined) {
        if (!isRecord(value.semantics)) {
            collector.add(`${path}.semantics`, "must be an object", value.semantics);
        } else {
            if (value.semantics.activation !== undefined) validateString(value.semantics.activation, `${path}.semantics.activation`, collector);
            if (value.semantics.completion !== undefined) validateString(value.semantics.completion, `${path}.semantics.completion`, collector);
            if (value.semantics.preserve !== undefined) validateStringArray(value.semantics.preserve, `${path}.semantics.preserve`, collector);
            if (value.semantics.continuationRole !== undefined) validateString(value.semantics.continuationRole, `${path}.semantics.continuationRole`, collector);
        }
    }
    return true;
}

function validateEmit(value: unknown, path: string, collector: ValidationCollector): value is ModuleBridgeEmitSpec {
    if (!isRecord(value)) {
        collector.add(path, "must be an object", value);
        return false;
    }
    if (value.reason !== undefined) validateString(value.reason, `${path}.reason`, collector);
    if (value.mode !== undefined) validateStringEnum(value.mode, VALID_TRANSFER_MODES, `${path}.mode`, collector);
    if (value.boundary !== undefined) validateStringEnum(value.boundary, VALID_BOUNDARY_KINDS, `${path}.boundary`, collector);
    if (value.allowUnreachableTarget !== undefined) validateBoolean(value.allowUnreachableTarget, `${path}.allowUnreachableTarget`, collector);
    return true;
}

function validateConstraint(value: unknown, path: string, collector: ValidationCollector): value is ModuleConstraint {
    if (!isRecord(value)) {
        collector.add(path, "must be an object", value);
        return false;
    }
    if (!validateString(value.kind, `${path}.kind`, collector)) {
        return false;
    }
    switch (value.kind) {
        case "same_receiver":
            if (value.fallbackMode !== undefined) {
                collector.add(`${path}.fallbackMode`, "is not supported");
            }
            return true;
        case "same_address":
            validateAddress(value.left, `${path}.left`, collector);
            validateAddress(value.right, `${path}.right`, collector);
            return true;
        default:
            collector.add(`${path}.kind`, "must be one of: \"same_receiver\", \"same_address\"", value.kind);
            return false;
    }
}

function validateSemanticCommon(value: Record<string, unknown>, path: string, collector: ValidationCollector): boolean {
    const okId = value.id === undefined || validateString(value.id, `${path}.id`, collector);
    const okKind = validateStringEnum(value.kind, VALID_SEMANTIC_KINDS, `${path}.kind`, collector);
    return okId && okKind;
}

function validateSemantic(value: unknown, path: string, collector: ValidationCollector): value is ModuleSemantic {
    if (!isRecord(value)) {
        collector.add(path, "must be an object", value);
        return false;
    }
    const ok = validateSemanticCommon(value, path, collector);
    if (!ok) {
        return false;
    }
    switch (value.kind) {
        case "bridge":
            validateEndpoint(value.from, `${path}.from`, collector);
            validateEndpoint(value.to, `${path}.to`, collector);
            if (value.constraints !== undefined) {
                if (!Array.isArray(value.constraints)) {
                    collector.add(`${path}.constraints`, "must be an array", value.constraints);
                } else {
                    value.constraints.forEach((item, index) => validateConstraint(item, `${path}.constraints[${index}]`, collector));
                }
            }
            if (value.dispatch !== undefined) validateDispatch(value.dispatch, `${path}.dispatch`, collector);
            if (value.emit !== undefined) validateEmit(value.emit, `${path}.emit`, collector);
            return true;
        case "state":
            if (!isRecord(value.cell)) {
                collector.add(`${path}.cell`, "must be an object", value.cell);
            } else if (!validateString(value.cell.kind, `${path}.cell.kind`, collector)) {
                return false;
            } else {
                switch (value.cell.kind) {
                    case "keyed_state":
                    case "channel":
                        if (value.cell.label !== undefined) validateString(value.cell.label, `${path}.cell.label`, collector);
                        break;
                    case "field":
                        validateEndpoint(value.cell.carrier, `${path}.cell.carrier`, collector);
                        validateStringArray(value.cell.fieldPath, `${path}.cell.fieldPath`, collector);
                        break;
                    default:
                        collector.add(`${path}.cell.kind`, "must be one of: \"keyed_state\", \"channel\", \"field\"", value.cell.kind);
                }
            }
            if (!Array.isArray(value.writes)) {
                collector.add(`${path}.writes`, "must be an array", value.writes);
            } else {
                value.writes.forEach((write, index) => {
                    if (!isRecord(write)) {
                        collector.add(`${path}.writes[${index}]`, "must be an object", write);
                        return;
                    }
                    validateEndpoint(write.from, `${path}.writes[${index}].from`, collector);
                    if (write.address !== undefined) validateAddress(write.address, `${path}.writes[${index}].address`, collector);
                    if (write.emit !== undefined) validateEmit(write.emit, `${path}.writes[${index}].emit`, collector);
                });
            }
            if (!Array.isArray(value.reads)) {
                collector.add(`${path}.reads`, "must be an array", value.reads);
            } else {
                value.reads.forEach((read, index) => {
                    if (!isRecord(read)) {
                        collector.add(`${path}.reads[${index}]`, "must be an object", read);
                        return;
                    }
                    validateEndpoint(read.to, `${path}.reads[${index}].to`, collector);
                    if (read.address !== undefined) validateAddress(read.address, `${path}.reads[${index}].address`, collector);
                    if (read.dispatch !== undefined) validateDispatch(read.dispatch, `${path}.reads[${index}].dispatch`, collector);
                    if (read.emit !== undefined) validateEmit(read.emit, `${path}.reads[${index}].emit`, collector);
                });
            }
            return true;
        case "declarative_binding":
            validateSurfaceRef(value.source, `${path}.source`, collector);
            validateSurfaceRef(value.handler, `${path}.handler`, collector);
            validateString(value.triggerLabel, `${path}.triggerLabel`, collector);
            if (value.dispatch !== undefined) validateDispatch(value.dispatch, `${path}.dispatch`, collector);
            return true;
        case "handoff_effect":
            if (!Array.isArray(value.effects)) {
                collector.add(`${path}.effects`, "must be an array", value.effects);
            } else {
                value.effects.forEach((effect, index) => validateHandoffEffectSpec(effect, `${path}.effects[${index}]`, collector));
            }
            return true;
        case "container":
            if (value.families !== undefined) {
                if (!Array.isArray(value.families)) {
                    collector.add(`${path}.families`, "must be an array", value.families);
                } else {
                    value.families.forEach((family, index) => validateStringEnum(family, VALID_CONTAINER_FAMILIES, `${path}.families[${index}]`, collector));
                }
            }
            if (value.capabilities !== undefined) {
                if (!Array.isArray(value.capabilities)) {
                    collector.add(`${path}.capabilities`, "must be an array", value.capabilities);
                } else {
                    value.capabilities.forEach((capability, index) => validateStringEnum(capability, VALID_CONTAINER_CAPABILITIES, `${path}.capabilities[${index}]`, collector));
                }
            }
            validateStringArray(value.mutationCanonicalApiIds, `${path}.mutationCanonicalApiIds`, collector);
            validateStringArray(value.accessCanonicalApiIds, `${path}.accessCanonicalApiIds`, collector);
            return true;
        case "ability_handoff":
            validateStringArray(value.startCanonicalApiIds, `${path}.startCanonicalApiIds`, collector);
            validateStringArray(value.targetCanonicalApiIds, `${path}.targetCanonicalApiIds`, collector);
            return true;
        case "keyed_storage":
            validateKeyedStorageWriteApis(value.writeApis, `${path}.writeApis`, collector);
            if (value.writeResultApis !== undefined) {
                validateKeyedStorageWriteApis(value.writeResultApis, `${path}.writeResultApis`, collector);
            }
            validateStringArray(value.readCanonicalApiIds, `${path}.readCanonicalApiIds`, collector);
            if (value.killCanonicalApiIds !== undefined) validateStringArray(value.killCanonicalApiIds, `${path}.killCanonicalApiIds`, collector);
            if (value.propDecoratorCanonicalApiIds !== undefined) validateStringArray(value.propDecoratorCanonicalApiIds, `${path}.propDecoratorCanonicalApiIds`, collector);
            if (value.linkDecoratorCanonicalApiIds !== undefined) validateStringArray(value.linkDecoratorCanonicalApiIds, `${path}.linkDecoratorCanonicalApiIds`, collector);
            return true;
        case "event_emitter":
            validateStringArray(value.onCanonicalApiIds, `${path}.onCanonicalApiIds`, collector);
            validateStringArray(value.emitCanonicalApiIds, `${path}.emitCanonicalApiIds`, collector);
            if (value.channelArgIndexes !== undefined) {
                if (!Array.isArray(value.channelArgIndexes)) {
                    collector.add(`${path}.channelArgIndexes`, "must be an array", value.channelArgIndexes);
                } else {
                    value.channelArgIndexes.forEach((index, idx) => validateInteger(index, `${path}.channelArgIndexes[${idx}]`, collector));
                }
            }
            if (value.payloadArgIndex !== undefined) validateEventEmitterPayloadArgIndex(value.payloadArgIndex, `${path}.payloadArgIndex`, collector);
            if (value.callbackArgIndex !== undefined) validateInteger(value.callbackArgIndex, `${path}.callbackArgIndex`, collector);
            if (value.callbackParamIndex !== undefined) validateInteger(value.callbackParamIndex, `${path}.callbackParamIndex`, collector);
            if (value.maxCandidates !== undefined) validateInteger(value.maxCandidates, `${path}.maxCandidates`, collector);
            return true;
        case "route_bridge":
            if (!Array.isArray(value.pushApis)) {
                collector.add(`${path}.pushApis`, "must be an array", value.pushApis);
            } else {
                value.pushApis.forEach((pushApi, index) => {
                    if (!isRecord(pushApi)) {
                        collector.add(`${path}.pushApis[${index}]`, "must be an object", pushApi);
                        return;
                    }
                    validateStringArray(pushApi.canonicalApiIds, `${path}.pushApis[${index}].canonicalApiIds`, collector);
                    if (pushApi.routeField !== undefined) validateString(pushApi.routeField, `${path}.pushApis[${index}].routeField`, collector);
                    if (pushApi.routeArgIndex !== undefined) validateInteger(pushApi.routeArgIndex, `${path}.pushApis[${index}].routeArgIndex`, collector);
                    if (pushApi.payloadArgIndex !== undefined) validateInteger(pushApi.payloadArgIndex, `${path}.pushApis[${index}].payloadArgIndex`, collector);
                    if (pushApi.payloadField !== undefined) validateString(pushApi.payloadField, `${path}.pushApis[${index}].payloadField`, collector);
                });
            }
            validateStringArray(value.getCanonicalApiIds, `${path}.getCanonicalApiIds`, collector);
            if (value.navDestinationRegisterApis !== undefined) {
                if (!Array.isArray(value.navDestinationRegisterApis)) {
                    collector.add(`${path}.navDestinationRegisterApis`, "must be an array", value.navDestinationRegisterApis);
                } else {
                    value.navDestinationRegisterApis.forEach((api, index) => {
                        if (!isRecord(api)) {
                            collector.add(`${path}.navDestinationRegisterApis[${index}]`, "must be an object", api);
                            return;
                        }
                        validateStringArray(api.canonicalApiIds, `${path}.navDestinationRegisterApis[${index}].canonicalApiIds`, collector);
                        validateInteger(api.callbackArgIndex, `${path}.navDestinationRegisterApis[${index}].callbackArgIndex`, collector);
                        if (api.routeParamIndex !== undefined) validateInteger(api.routeParamIndex, `${path}.navDestinationRegisterApis[${index}].routeParamIndex`, collector);
                        validateInteger(api.payloadParamIndex, `${path}.navDestinationRegisterApis[${index}].payloadParamIndex`, collector);
                    });
                }
            }
            if (value.navDestinationTriggerApis !== undefined) {
                if (!Array.isArray(value.navDestinationTriggerApis)) {
                    collector.add(`${path}.navDestinationTriggerApis`, "must be an array", value.navDestinationTriggerApis);
                } else {
                    value.navDestinationTriggerApis.forEach((api, index) => {
                        if (!isRecord(api)) {
                            collector.add(`${path}.navDestinationTriggerApis[${index}]`, "must be an object", api);
                            return;
                        }
                        validateStringArray(api.canonicalApiIds, `${path}.navDestinationTriggerApis[${index}].canonicalApiIds`, collector);
                        if (api.routeField !== undefined) validateString(api.routeField, `${path}.navDestinationTriggerApis[${index}].routeField`, collector);
                        if (api.routeArgIndex !== undefined) validateInteger(api.routeArgIndex, `${path}.navDestinationTriggerApis[${index}].routeArgIndex`, collector);
                        if (api.payloadArgIndex !== undefined) validateInteger(api.payloadArgIndex, `${path}.navDestinationTriggerApis[${index}].payloadArgIndex`, collector);
                        if (api.payloadField !== undefined) validateString(api.payloadField, `${path}.navDestinationTriggerApis[${index}].payloadField`, collector);
                    });
                }
            }
            if (value.payloadUnwrapPrefixes !== undefined) validateStringArray(value.payloadUnwrapPrefixes, `${path}.payloadUnwrapPrefixes`, collector);
            return true;
        case "state_binding":
            validateStringArray(value.stateDecoratorCanonicalApiIds, `${path}.stateDecoratorCanonicalApiIds`, collector);
            validateStringArray(value.propDecoratorCanonicalApiIds, `${path}.propDecoratorCanonicalApiIds`, collector);
            validateStringArray(value.linkDecoratorCanonicalApiIds, `${path}.linkDecoratorCanonicalApiIds`, collector);
            if (value.provideDecoratorCanonicalApiIds !== undefined) validateStringArray(value.provideDecoratorCanonicalApiIds, `${path}.provideDecoratorCanonicalApiIds`, collector);
            if (value.consumeDecoratorCanonicalApiIds !== undefined) validateStringArray(value.consumeDecoratorCanonicalApiIds, `${path}.consumeDecoratorCanonicalApiIds`, collector);
            if (value.eventDecoratorCanonicalApiIds !== undefined) validateStringArray(value.eventDecoratorCanonicalApiIds, `${path}.eventDecoratorCanonicalApiIds`, collector);
            return true;
    }
}

function validateKeyedStorageWriteApis(
    value: unknown,
    path: string,
    collector: ValidationCollector,
): void {
    if (!Array.isArray(value)) {
        collector.add(path, "must be an array", value);
        return;
    }
    value.forEach((writeApi, index) => {
        if (!isRecord(writeApi)) {
            collector.add(`${path}[${index}]`, "must be an object", writeApi);
            return;
        }
        validateStringArray(writeApi.canonicalApiIds, `${path}[${index}].canonicalApiIds`, collector);
        validateInteger(writeApi.valueIndex, `${path}[${index}].valueIndex`, collector);
        if (writeApi.updateStrength !== undefined) {
            validateStringEnum(
                writeApi.updateStrength,
                VALID_KEYED_STORAGE_UPDATE_STRENGTHS,
                `${path}[${index}].updateStrength`,
                collector,
            );
        }
    });
}

export function validateInternalModuleLoweringIROrThrow(spec: unknown): asserts spec is InternalModuleLoweringIR {
    const collector = new ValidationCollector();
    const specRecord = isRecord(spec) ? spec : undefined;
    const specId = specRecord && typeof specRecord.id === "string" ? specRecord.id : undefined;
    const seenSemanticIds = new Set<string>();

    if (!specRecord) {
        throw new InternalModuleLoweringIRValidationError(undefined, ["module spec root must be an object"]);
    }

    validateString(specRecord.id, "id", collector);
    if (specRecord.description !== undefined) {
        validateString(specRecord.description, "description", collector, { allowEmpty: true });
    }
    if (specRecord.enabled !== undefined) validateBoolean(specRecord.enabled, "enabled", collector);

    if (!Array.isArray(specRecord.semantics)) {
        collector.add("semantics", "must be an array", specRecord.semantics);
    } else if (specRecord.semantics.length === 0) {
        collector.add("semantics", "must be a non-empty array");
    } else {
        specRecord.semantics.forEach((semantic, index) => {
            validateSemantic(semantic, `semantics[${index}]`, collector);
            if (isRecord(semantic) && typeof semantic.id === "string" && semantic.id.trim().length > 0) {
                if (seenSemanticIds.has(semantic.id)) {
                    collector.add(`semantics[${index}].id`, "must be unique within one InternalModuleLoweringIR", semantic.id);
                }
                seenSemanticIds.add(semantic.id);
            }
        });
    }

    if (collector.hasIssues) {
        throw new InternalModuleLoweringIRValidationError(specId, collector.toArray());
    }
}
