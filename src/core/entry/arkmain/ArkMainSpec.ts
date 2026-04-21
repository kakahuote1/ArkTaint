import type {
    ArkMainFactKind,
    ArkMainOwnerKind,
    ArkMainPhaseName,
} from "./ArkMainTypes";

export interface ArkMainSelector {
    methodName: string;
    parameterTypes: string[];
    returnType?: string;
    className?: string;
    superClassName?: string;
    requireOverride?: boolean;
}

export interface ArkMainSpecEntryPattern {
    phase: ArkMainPhaseName;
    kind: Extract<ArkMainFactKind,
        "ability_lifecycle" | "stage_lifecycle" | "extension_lifecycle" | "page_build" | "page_lifecycle" | "callback"
    >;
    ownerKind?: ArkMainOwnerKind;
    schedule?: boolean;
    reason?: string;
    entryFamily?: string;
    entryShape?: string;
}

export interface ArkMainSpec {
    enabled?: boolean;
    description?: string;
    selector: ArkMainSelector;
    entryPattern: ArkMainSpecEntryPattern;
}

export interface ArkMainSpecDocument {
    schemaVersion?: number;
    entries: ArkMainSpec[];
}

const ENTRY_PHASES: ArkMainSpecEntryPattern["phase"][] = [
    "bootstrap",
    "composition",
    "interaction",
    "reactive_handoff",
    "teardown",
];

const ENTRY_KINDS: ArkMainSpecEntryPattern["kind"][] = [
    "ability_lifecycle",
    "stage_lifecycle",
    "extension_lifecycle",
    "page_build",
    "page_lifecycle",
    "callback",
];

const OWNER_KINDS: NonNullable<ArkMainSpecEntryPattern["ownerKind"]>[] = [
    "ability_owner",
    "stage_owner",
    "extension_owner",
    "component_owner",
    "builder_owner",
    "unknown_owner",
];

export function validateArkMainSpecDocumentOrThrow(value: unknown, path = "arkmain"): ArkMainSpecDocument {
    const doc = expectRecord(value, path);
    const schemaVersion = doc.schemaVersion;
    if (schemaVersion !== undefined && (!Number.isInteger(schemaVersion as number) || (schemaVersion as number) <= 0)) {
        throw new Error(`${path}.schemaVersion must be a positive integer`);
    }
    if (!Array.isArray(doc.entries)) {
        throw new Error(`${path}.entries must be an array`);
    }
    const entries = doc.entries.map((entry: unknown, index: number) =>
        validateArkMainSpecOrThrow(entry, `${path}.entries[${index}]`),
    );
    return {
        schemaVersion: schemaVersion === undefined ? 1 : (schemaVersion as number),
        entries,
    };
}

export function validateArkMainSpecOrThrow(value: unknown, path = "arkmain.entry"): ArkMainSpec {
    const entry = expectRecord(value, path);
    const selector = validateArkMainSelectorOrThrow(entry.selector, `${path}.selector`);
    const entryPattern = validateArkMainEntryPatternOrThrow(entry.entryPattern, `${path}.entryPattern`);
    return {
        enabled: entry.enabled === undefined ? true : expectBoolean(entry.enabled, `${path}.enabled`),
        description: optionalString(entry.description),
        selector,
        entryPattern,
    };
}

export function validateArkMainSelectorOrThrow(value: unknown, path = "arkmain.selector"): ArkMainSelector {
    const selector = expectRecord(value, path);
    const methodName = expectString(selector.methodName, `${path}.methodName`);
    if (!Array.isArray(selector.parameterTypes)) {
        throw new Error(`${path}.parameterTypes must be an array`);
    }
    const parameterTypes = selector.parameterTypes.map((item: unknown, index: number) =>
        expectString(item, `${path}.parameterTypes[${index}]`),
    );
    const className = optionalString(selector.className);
    const superClassName = optionalString(selector.superClassName);
    if (!className && !superClassName) {
        throw new Error(`${path}.className or ${path}.superClassName is required`);
    }
    return {
        methodName,
        parameterTypes,
        returnType: optionalString(selector.returnType),
        className,
        superClassName,
        requireOverride: selector.requireOverride === undefined
            ? undefined
            : expectBoolean(selector.requireOverride, `${path}.requireOverride`),
    };
}

export function validateArkMainEntryPatternOrThrow(
    value: unknown,
    path = "arkmain.entryPattern",
): ArkMainSpecEntryPattern {
    const pattern = expectRecord(value, path);
    const phase = expectEnum(pattern.phase, `${path}.phase`, ENTRY_PHASES);
    const kind = expectEnum(pattern.kind, `${path}.kind`, ENTRY_KINDS);
    const ownerKind = pattern.ownerKind === undefined
        ? undefined
        : expectEnum(pattern.ownerKind, `${path}.ownerKind`, OWNER_KINDS);
    return {
        phase,
        kind,
        ownerKind,
        schedule: pattern.schedule === undefined ? undefined : expectBoolean(pattern.schedule, `${path}.schedule`),
        reason: optionalString(pattern.reason),
        entryFamily: optionalString(pattern.entryFamily),
        entryShape: optionalString(pattern.entryShape),
    };
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${path} must be an object`);
    }
    return value as Record<string, unknown>;
}

function expectString(value: unknown, path: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${path} must be a non-empty string`);
    }
    return value.trim();
}

function optionalString(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") {
        throw new Error(`expected string, got ${typeof value}`);
    }
    const text = value.trim();
    return text.length > 0 ? text : undefined;
}

function expectBoolean(value: unknown, path: string): boolean {
    if (typeof value !== "boolean") {
        throw new Error(`${path} must be a boolean`);
    }
    return value;
}

function expectEnum<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
    const text = expectString(value, path);
    if (!allowed.includes(text as T)) {
        throw new Error(`${path} invalid: ${text}`);
    }
    return text as T;
}
