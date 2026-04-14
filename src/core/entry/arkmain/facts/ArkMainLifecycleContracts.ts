import * as fs from "fs";
import * as path from "path";
import { ArkMainFactKind, ArkMainPhaseName } from "../ArkMainTypes";

export interface ArkMainLifecycleContractMatch {
    phase: ArkMainPhaseName;
    kind: Extract<ArkMainFactKind, "ability_lifecycle" | "stage_lifecycle" | "extension_lifecycle" | "page_build" | "page_lifecycle">;
    entryFamily: "ability_lifecycle" | "stage_lifecycle" | "extension_lifecycle" | "page_build" | "page_lifecycle";
    entryShape: "override_slot" | "declaration_owner_slot";
    reason: string;
}

interface ArkMainOverrideLifecycleCatalogEntry {
    owner: "ability" | "stage" | "extension";
    kind: Extract<ArkMainFactKind, "ability_lifecycle" | "stage_lifecycle" | "extension_lifecycle">;
    entryFamily: ArkMainLifecycleContractMatch["entryFamily"];
    entryShape: Extract<ArkMainLifecycleContractMatch["entryShape"], "override_slot">;
    reasonPrefix: string;
    phases: Record<ArkMainPhaseName, string[]>;
}

interface ArkMainDeclarationLifecycleCatalogEntry {
    owner: "component";
    phase: ArkMainPhaseName;
    kind: Extract<ArkMainFactKind, "page_build" | "page_lifecycle">;
    entryFamily: Extract<ArkMainLifecycleContractMatch["entryFamily"], "page_build" | "page_lifecycle">;
    entryShape: Extract<ArkMainLifecycleContractMatch["entryShape"], "declaration_owner_slot">;
    reasonPrefix: string;
    methodNames: string[];
}

interface ArkMainLifecycleCatalogDocument {
    schemaVersion: number;
    overrideContracts: ArkMainOverrideLifecycleCatalogEntry[];
    declarationContracts: ArkMainDeclarationLifecycleCatalogEntry[];
}

interface ArkMainDeclarationLifecycleRule {
    phase: ArkMainPhaseName;
    kind: ArkMainLifecycleContractMatch["kind"];
    entryFamily: ArkMainLifecycleContractMatch["entryFamily"];
    entryShape: ArkMainLifecycleContractMatch["entryShape"];
    reasonPrefix: string;
    methodNames: ReadonlySet<string>;
}

const PHASES: ArkMainPhaseName[] = [
    "bootstrap",
    "composition",
    "interaction",
    "reactive_handoff",
    "teardown",
];

let cachedCatalog: ArkMainLifecycleCatalogDocument | undefined;

export function resolveAbilityLifecycleContractFromOverride(methodName: string): ArkMainLifecycleContractMatch | null {
    return resolveOverrideLifecycleContract("ability", methodName);
}

export function resolveAbilityLifecycleContract(methodName: string): ArkMainLifecycleContractMatch | null {
    return resolveOverrideLifecycleContract("ability", methodName);
}

export function resolveStageLifecycleContractFromOverride(methodName: string): ArkMainLifecycleContractMatch | null {
    return resolveOverrideLifecycleContract("stage", methodName);
}

export function resolveStageLifecycleContract(methodName: string): ArkMainLifecycleContractMatch | null {
    return resolveOverrideLifecycleContract("stage", methodName);
}

export function resolveExtensionLifecycleContractFromOverride(methodName: string): ArkMainLifecycleContractMatch | null {
    return resolveOverrideLifecycleContract("extension", methodName);
}

export function resolveExtensionLifecycleContract(methodName: string): ArkMainLifecycleContractMatch | null {
    return resolveOverrideLifecycleContract("extension", methodName);
}

export function resolveComponentLifecycleContract(methodName: string): ArkMainLifecycleContractMatch | null {
    return resolveContractByMethodName(
        getLifecycleCatalog().declarationContracts.map(entry => ({
            phase: entry.phase,
            kind: entry.kind,
            entryFamily: entry.entryFamily,
            entryShape: entry.entryShape,
            reasonPrefix: entry.reasonPrefix,
            methodNames: new Set(entry.methodNames),
        })),
        methodName,
    );
}

function resolveOverrideLifecycleContract(
    owner: ArkMainOverrideLifecycleCatalogEntry["owner"],
    methodName: string,
): ArkMainLifecycleContractMatch | null {
    const entry = getLifecycleCatalog().overrideContracts.find(item => item.owner === owner);
    if (!entry) {
        throw new Error(`missing arkmain lifecycle override contract catalog for owner=${owner}`);
    }
    const phase = resolveOverridePhase(entry, methodName);
    if (!phase) {
        return null;
    }
    return {
        phase,
        kind: entry.kind,
        entryFamily: entry.entryFamily,
        entryShape: entry.entryShape,
        reason: `${entry.reasonPrefix} ${methodName}`,
    };
}

function resolveOverridePhase(
    entry: ArkMainOverrideLifecycleCatalogEntry,
    methodName: string,
): ArkMainPhaseName | null {
    for (const phase of PHASES) {
        if (entry.phases[phase]?.includes(methodName)) {
            return phase;
        }
    }
    return null;
}

function resolveContractByMethodName(
    rules: readonly ArkMainDeclarationLifecycleRule[],
    methodName: string,
): ArkMainLifecycleContractMatch | null {
    for (const rule of rules) {
        if (!rule.methodNames.has(methodName)) continue;
        return {
            phase: rule.phase,
            kind: rule.kind,
            entryFamily: rule.entryFamily,
            entryShape: rule.entryShape,
            reason: `${rule.reasonPrefix} ${methodName}`,
        };
    }
    return null;
}

function getLifecycleCatalog(): ArkMainLifecycleCatalogDocument {
    if (cachedCatalog) {
        return cachedCatalog;
    }
    const catalogPath = resolveLifecycleCatalogPath();
    if (!fs.existsSync(catalogPath) || !fs.statSync(catalogPath).isFile()) {
        throw new Error(`arkmain lifecycle contract catalog not found: ${catalogPath}`);
    }
    const parsed = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
    cachedCatalog = validateLifecycleCatalog(parsed, catalogPath);
    return cachedCatalog;
}

function resolveLifecycleCatalogPath(): string {
    const candidates = [
        path.resolve(__dirname, "../../../../../src/models/kernel/arkmain/harmony/lifecycle.contracts.json"),
        path.resolve(process.cwd(), "src/models/kernel/arkmain/harmony/lifecycle.contracts.json"),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
    }
    return candidates[0];
}

function validateLifecycleCatalog(value: unknown, catalogPath: string): ArkMainLifecycleCatalogDocument {
    const doc = expectRecord(value, catalogPath);
    const schemaVersion = expectPositiveInteger(doc.schemaVersion, `${catalogPath}.schemaVersion`);
    if (!Array.isArray(doc.overrideContracts)) {
        throw new Error(`${catalogPath}.overrideContracts must be an array`);
    }
    if (!Array.isArray(doc.declarationContracts)) {
        throw new Error(`${catalogPath}.declarationContracts must be an array`);
    }
    return {
        schemaVersion,
        overrideContracts: doc.overrideContracts.map((item: unknown, index: number) =>
            validateOverrideContract(item, `${catalogPath}.overrideContracts[${index}]`),
        ),
        declarationContracts: doc.declarationContracts.map((item: unknown, index: number) =>
            validateDeclarationContract(item, `${catalogPath}.declarationContracts[${index}]`),
        ),
    };
}

function validateOverrideContract(value: unknown, pathText: string): ArkMainOverrideLifecycleCatalogEntry {
    const entry = expectRecord(value, pathText);
    const owner = expectEnum(entry.owner, `${pathText}.owner`, ["ability", "stage", "extension"]);
    const kind = expectEnum(entry.kind, `${pathText}.kind`, [
        "ability_lifecycle",
        "stage_lifecycle",
        "extension_lifecycle",
    ]) as ArkMainOverrideLifecycleCatalogEntry["kind"];
    const entryFamily = expectEnum(entry.entryFamily, `${pathText}.entryFamily`, [
        "ability_lifecycle",
        "stage_lifecycle",
        "extension_lifecycle",
    ]) as ArkMainOverrideLifecycleCatalogEntry["entryFamily"];
    const entryShape = expectEnum(
        entry.entryShape,
        `${pathText}.entryShape`,
        ["override_slot"],
    ) as ArkMainOverrideLifecycleCatalogEntry["entryShape"];
    const reasonPrefix = expectString(entry.reasonPrefix, `${pathText}.reasonPrefix`);
    const phases = expectRecord(entry.phases, `${pathText}.phases`);
    const normalizedPhases = {} as Record<ArkMainPhaseName, string[]>;
    for (const phase of PHASES) {
        const valueAtPhase = phases[phase];
        if (!Array.isArray(valueAtPhase)) {
            throw new Error(`${pathText}.phases.${phase} must be an array`);
        }
        normalizedPhases[phase] = valueAtPhase.map((item: unknown, index: number) =>
            expectString(item, `${pathText}.phases.${phase}[${index}]`),
        );
    }
    return {
        owner: owner as ArkMainOverrideLifecycleCatalogEntry["owner"],
        kind,
        entryFamily,
        entryShape,
        reasonPrefix,
        phases: normalizedPhases,
    };
}

function validateDeclarationContract(value: unknown, pathText: string): ArkMainDeclarationLifecycleCatalogEntry {
    const entry = expectRecord(value, pathText);
    const owner = expectEnum(entry.owner, `${pathText}.owner`, ["component"]);
    const phase = expectEnum(entry.phase, `${pathText}.phase`, PHASES) as ArkMainPhaseName;
    const kind = expectEnum(
        entry.kind,
        `${pathText}.kind`,
        ["page_build", "page_lifecycle"],
    ) as ArkMainDeclarationLifecycleCatalogEntry["kind"];
    const entryFamily = expectEnum(
        entry.entryFamily,
        `${pathText}.entryFamily`,
        ["page_build", "page_lifecycle"],
    ) as ArkMainDeclarationLifecycleCatalogEntry["entryFamily"];
    const entryShape = expectEnum(
        entry.entryShape,
        `${pathText}.entryShape`,
        ["declaration_owner_slot"],
    ) as ArkMainDeclarationLifecycleCatalogEntry["entryShape"];
    const reasonPrefix = expectString(entry.reasonPrefix, `${pathText}.reasonPrefix`);
    if (!Array.isArray(entry.methodNames)) {
        throw new Error(`${pathText}.methodNames must be an array`);
    }
    const methodNames = entry.methodNames.map((item: unknown, index: number) =>
        expectString(item, `${pathText}.methodNames[${index}]`),
    );
    return {
        owner: owner as "component",
        phase,
        kind,
        entryFamily,
        entryShape,
        reasonPrefix,
        methodNames,
    };
}

function expectRecord(value: unknown, pathText: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${pathText} must be an object`);
    }
    return value as Record<string, unknown>;
}

function expectString(value: unknown, pathText: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${pathText} must be a non-empty string`);
    }
    return value.trim();
}

function expectEnum<T extends string>(value: unknown, pathText: string, allowed: readonly T[]): T {
    const text = expectString(value, pathText);
    if (!allowed.includes(text as T)) {
        throw new Error(`${pathText} invalid: ${text}`);
    }
    return text as T;
}

function expectPositiveInteger(value: unknown, pathText: string): number {
    if (!Number.isInteger(value) || (value as number) <= 0) {
        throw new Error(`${pathText} must be a positive integer`);
    }
    return value as number;
}
