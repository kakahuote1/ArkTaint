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
    ModuleSpec,
} from "../../kernel/contracts/ModuleSpec";

const VALID_SEMANTIC_KINDS = new Set([
    "bridge",
    "state",
    "declarative_binding",
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

export class ModuleSpecValidationError extends Error {
    readonly specId?: string;
    readonly issues: string[];

    constructor(specId: string | undefined, issues: string[]) {
        const title = specId && specId.trim().length > 0
            ? `Invalid ModuleSpec "${specId}"`
            : "Invalid ModuleSpec";
        super(`${title}:\n${issues.map(issue => `  - ${issue}`).join("\n")}`);
        this.name = "ModuleSpecValidationError";
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
    if (value.methodName !== undefined) validateString(value.methodName, `${path}.methodName`, collector);
    if (value.declaringClassName !== undefined) validateString(value.declaringClassName, `${path}.declaringClassName`, collector);
    if (value.declaringClassIncludes !== undefined) validateString(value.declaringClassIncludes, `${path}.declaringClassIncludes`, collector);
    if (value.signature !== undefined) validateString(value.signature, `${path}.signature`, collector);
    if (value.signatureIncludes !== undefined) validateString(value.signatureIncludes, `${path}.signatureIncludes`, collector);
    if (value.minArgs !== undefined) validateInteger(value.minArgs, `${path}.minArgs`, collector);
    if (value.instanceOnly !== undefined) validateBoolean(value.instanceOnly, `${path}.instanceOnly`, collector);
    if (value.staticOnly !== undefined) validateBoolean(value.staticOnly, `${path}.staticOnly`, collector);
}

function validateMethodSelector(value: Record<string, unknown>, path: string, collector: ValidationCollector): void {
    if (value.methodSignature !== undefined) validateString(value.methodSignature, `${path}.methodSignature`, collector);
    if (value.methodName !== undefined) validateString(value.methodName, `${path}.methodName`, collector);
    if (value.declaringClassName !== undefined) validateString(value.declaringClassName, `${path}.declaringClassName`, collector);
    if (value.declaringClassIncludes !== undefined) validateString(value.declaringClassIncludes, `${path}.declaringClassIncludes`, collector);
}

function validateDecoratedFieldSelector(value: Record<string, unknown>, path: string, collector: ValidationCollector): void {
    if (value.className !== undefined) validateString(value.className, `${path}.className`, collector);
    if (value.classNameIncludes !== undefined) validateString(value.classNameIncludes, `${path}.classNameIncludes`, collector);
    if (value.fieldName !== undefined) validateString(value.fieldName, `${path}.fieldName`, collector);
    if (value.fieldSignature !== undefined) validateString(value.fieldSignature, `${path}.fieldSignature`, collector);
    if (value.decoratorKind !== undefined) validateString(value.decoratorKind, `${path}.decoratorKind`, collector);
    if (value.decoratorKinds !== undefined) validateStringArray(value.decoratorKinds, `${path}.decoratorKinds`, collector);
    if (value.decoratorParam !== undefined) validateString(value.decoratorParam, `${path}.decoratorParam`, collector);
    if (value.decoratorParams !== undefined) validateStringArray(value.decoratorParams, `${path}.decoratorParams`, collector);
}

function validateSurfaceRef(value: unknown, path: string, collector: ValidationCollector): boolean {
    if (typeof value === "string") {
        return validateString(value, path, collector);
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
            if (value.decoratorKind !== undefined) validateString(value.decoratorKind, `${path}.decoratorKind`, collector);
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
                validateStringEnum(value.fallbackMode, new Set(["none", "all_targets_if_unmatched"]), `${path}.fallbackMode`, collector);
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
            return true;
        case "ability_handoff":
            validateStringArray(value.startMethods, `${path}.startMethods`, collector);
            validateStringArray(value.targetMethods, `${path}.targetMethods`, collector);
            return true;
        case "keyed_storage":
            validateStringArray(value.storageClasses, `${path}.storageClasses`, collector);
            if (!Array.isArray(value.writeMethods)) {
                collector.add(`${path}.writeMethods`, "must be an array", value.writeMethods);
            } else {
                value.writeMethods.forEach((writeMethod, index) => {
                    if (!isRecord(writeMethod)) {
                        collector.add(`${path}.writeMethods[${index}]`, "must be an object", writeMethod);
                        return;
                    }
                    validateString(writeMethod.methodName, `${path}.writeMethods[${index}].methodName`, collector);
                    validateInteger(writeMethod.valueIndex, `${path}.writeMethods[${index}].valueIndex`, collector);
                });
            }
            validateStringArray(value.readMethods, `${path}.readMethods`, collector);
            if (value.propDecorators !== undefined) validateStringArray(value.propDecorators, `${path}.propDecorators`, collector);
            if (value.linkDecorators !== undefined) validateStringArray(value.linkDecorators, `${path}.linkDecorators`, collector);
            return true;
        case "event_emitter":
            if (value.onMethods !== undefined) validateStringArray(value.onMethods, `${path}.onMethods`, collector);
            if (value.emitMethods !== undefined) validateStringArray(value.emitMethods, `${path}.emitMethods`, collector);
            if (value.channelArgIndexes !== undefined) {
                if (!Array.isArray(value.channelArgIndexes)) {
                    collector.add(`${path}.channelArgIndexes`, "must be an array", value.channelArgIndexes);
                } else {
                    value.channelArgIndexes.forEach((index, idx) => validateInteger(index, `${path}.channelArgIndexes[${idx}]`, collector));
                }
            }
            if (value.payloadArgIndex !== undefined) validateInteger(value.payloadArgIndex, `${path}.payloadArgIndex`, collector);
            if (value.callbackArgIndex !== undefined) validateInteger(value.callbackArgIndex, `${path}.callbackArgIndex`, collector);
            if (value.callbackParamIndex !== undefined) validateInteger(value.callbackParamIndex, `${path}.callbackParamIndex`, collector);
            if (value.maxCandidates !== undefined) validateInteger(value.maxCandidates, `${path}.maxCandidates`, collector);
            return true;
        case "route_bridge":
            if (!Array.isArray(value.pushMethods)) {
                collector.add(`${path}.pushMethods`, "must be an array", value.pushMethods);
            } else {
                value.pushMethods.forEach((pushMethod, index) => {
                    if (!isRecord(pushMethod)) {
                        collector.add(`${path}.pushMethods[${index}]`, "must be an object", pushMethod);
                        return;
                    }
                    validateString(pushMethod.methodName, `${path}.pushMethods[${index}].methodName`, collector);
                    if (pushMethod.routeField !== undefined) validateString(pushMethod.routeField, `${path}.pushMethods[${index}].routeField`, collector);
                });
            }
            validateStringArray(value.getMethods, `${path}.getMethods`, collector);
            if (value.navDestinationClassNames !== undefined) validateStringArray(value.navDestinationClassNames, `${path}.navDestinationClassNames`, collector);
            if (value.navDestinationRegisterMethods !== undefined) validateStringArray(value.navDestinationRegisterMethods, `${path}.navDestinationRegisterMethods`, collector);
            if (value.frameworkSignatureHints !== undefined) validateStringArray(value.frameworkSignatureHints, `${path}.frameworkSignatureHints`, collector);
            if (value.payloadUnwrapPrefixes !== undefined) validateStringArray(value.payloadUnwrapPrefixes, `${path}.payloadUnwrapPrefixes`, collector);
            return true;
        case "state_binding":
            validateStringArray(value.stateDecorators, `${path}.stateDecorators`, collector);
            validateStringArray(value.propDecorators, `${path}.propDecorators`, collector);
            validateStringArray(value.linkDecorators, `${path}.linkDecorators`, collector);
            if (value.provideDecorators !== undefined) validateStringArray(value.provideDecorators, `${path}.provideDecorators`, collector);
            if (value.consumeDecorators !== undefined) validateStringArray(value.consumeDecorators, `${path}.consumeDecorators`, collector);
            if (value.eventDecorators !== undefined) validateStringArray(value.eventDecorators, `${path}.eventDecorators`, collector);
            return true;
    }
}

export function validateModuleSpecOrThrow(spec: unknown): asserts spec is ModuleSpec {
    const collector = new ValidationCollector();
    const specRecord = isRecord(spec) ? spec : undefined;
    const specId = specRecord && typeof specRecord.id === "string" ? specRecord.id : undefined;
    const seenSemanticIds = new Set<string>();

    if (!specRecord) {
        throw new ModuleSpecValidationError(undefined, ["module spec root must be an object"]);
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
                    collector.add(`semantics[${index}].id`, "must be unique within one ModuleSpec", semantic.id);
                }
                seenSemanticIds.add(semantic.id);
            }
        });
    }

    if (collector.hasIssues) {
        throw new ModuleSpecValidationError(specId, collector.toArray());
    }
}
