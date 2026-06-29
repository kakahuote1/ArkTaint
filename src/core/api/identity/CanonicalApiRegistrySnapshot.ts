import * as fs from "fs";
import * as path from "path";
import type {
    ApiAuthority,
    CanonicalApiDescriptor,
    IdentityEvidence,
} from "./CanonicalApiDescriptor";
import {
    fromOfficialDeclaration,
    fromProjectDeclaration,
    fromThirdPartyDeclaration,
    type CanonicalApiDeclarationEvidence,
} from "./CanonicalApiDescriptorBuilder";
import {
    assertValidCanonicalApiId,
    buildCanonicalApiId,
} from "./CanonicalApiId";
import { createCanonicalApiRegistry, type CanonicalApiRegistry } from "./CanonicalApiRegistry";

export interface CanonicalApiRegistrySnapshot {
    kind: "canonical_api_registry";
    authority: ApiAuthority | "mixed";
    generatedAt: string;
    descriptors: CanonicalApiDescriptor[];
    diagnostics: CanonicalApiRegistryDiagnostic[];
}

export interface CanonicalApiRegistryDiagnostic {
    severity: "error" | "warning";
    code: string;
    message: string;
    canonicalApiId?: string;
    evidence?: IdentityEvidence[];
}

export interface CanonicalApiRegistryBuildResult {
    ok: boolean;
    authority: ApiAuthority | "mixed";
    descriptors: CanonicalApiDescriptor[];
    diagnostics: CanonicalApiRegistryDiagnostic[];
}

export function buildOfficialDeclarationRegistry(
    declarations: readonly CanonicalApiDeclarationEvidence[],
): CanonicalApiRegistryBuildResult {
    return buildDeclarationRegistry("official", declarations);
}

export function buildProjectDeclarationRegistry(
    declarations: readonly CanonicalApiDeclarationEvidence[],
): CanonicalApiRegistryBuildResult {
    return buildDeclarationRegistry("project", declarations);
}

export function buildThirdPartyDeclarationRegistry(
    declarations: readonly CanonicalApiDeclarationEvidence[],
): CanonicalApiRegistryBuildResult {
    return buildDeclarationRegistry("third_party", declarations);
}

export function buildMixedDeclarationRegistry(input: {
    official?: readonly CanonicalApiDeclarationEvidence[];
    project?: readonly CanonicalApiDeclarationEvidence[];
    thirdParty?: readonly CanonicalApiDeclarationEvidence[];
}): CanonicalApiRegistryBuildResult {
    return mergeRegistryBuildResults("mixed", [
        buildOfficialDeclarationRegistry(input.official || []),
        buildProjectDeclarationRegistry(input.project || []),
        buildThirdPartyDeclarationRegistry(input.thirdParty || []),
    ]);
}

export function toCanonicalApiRegistrySnapshot(result: CanonicalApiRegistryBuildResult): CanonicalApiRegistrySnapshot {
    const snapshot: CanonicalApiRegistrySnapshot = {
        kind: "canonical_api_registry",
        authority: result.authority,
        generatedAt: new Date().toISOString(),
        descriptors: [...result.descriptors],
        diagnostics: [...result.diagnostics],
    };
    const validation = validateCanonicalApiRegistrySnapshot(snapshot);
    return {
        ...snapshot,
        diagnostics: [...snapshot.diagnostics, ...validation.diagnostics],
    };
}

export function writeCanonicalApiRegistrySnapshot(filePath: string, snapshot: CanonicalApiRegistrySnapshot): void {
    const validation = validateCanonicalApiRegistrySnapshot(snapshot);
    if (!validation.ok) {
        throw new Error(`invalid canonical API registry snapshot: ${validation.diagnostics.map(item => item.message).join("; ")}`);
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

export function loadCanonicalApiRegistrySnapshot(filePath: string): CanonicalApiRegistrySnapshot {
    const snapshot = JSON.parse(fs.readFileSync(filePath, "utf8")) as CanonicalApiRegistrySnapshot;
    const validation = validateCanonicalApiRegistrySnapshot(snapshot);
    if (!validation.ok) {
        throw new Error(`invalid canonical API registry snapshot ${filePath}: ${validation.diagnostics.map(item => item.message).join("; ")}`);
    }
    return snapshot;
}

export function loadCanonicalApiRegistryFromSnapshot(filePath: string): CanonicalApiRegistry {
    const snapshot = loadCanonicalApiRegistrySnapshot(filePath);
    return createCanonicalApiRegistry(snapshot.descriptors);
}

export function validateCanonicalApiRegistrySnapshot(snapshot: unknown): CanonicalApiRegistryBuildResult {
    const diagnostics: CanonicalApiRegistryDiagnostic[] = [];
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
        return {
            ok: false,
            authority: "mixed",
            descriptors: [],
            diagnostics: [diagnostic("error", "snapshot_not_object", "canonical API registry snapshot must be an object")],
        };
    }
    const value = snapshot as Partial<CanonicalApiRegistrySnapshot> & Record<string, unknown>;
    if (value.kind !== "canonical_api_registry") {
        diagnostics.push(diagnostic("error", "snapshot_kind_invalid", "canonical API registry snapshot kind must be canonical_api_registry"));
    }
    if ("schemaVersion" in value || "version" in value || "v" in value) {
        diagnostics.push(diagnostic("error", "snapshot_version_field_forbidden", "canonical API registry snapshot must not use version fields"));
    }
    const descriptors = Array.isArray(value.descriptors) ? value.descriptors as CanonicalApiDescriptor[] : [];
    if (!Array.isArray(value.descriptors)) {
        diagnostics.push(diagnostic("error", "snapshot_descriptors_missing", "canonical API registry snapshot descriptors must be an array"));
    }
    const seen = new Map<string, string>();
    for (const descriptor of descriptors) {
        validateDescriptor(descriptor, seen, diagnostics);
    }
    try {
        createCanonicalApiRegistry(descriptors);
    } catch (error) {
        diagnostics.push(diagnostic(
            "error",
            "snapshot_registry_collision",
            error instanceof Error ? error.message : String(error),
        ));
    }
    return {
        ok: !diagnostics.some(item => item.severity === "error"),
        authority: isSnapshotAuthority(value.authority) ? value.authority : "mixed",
        descriptors,
        diagnostics,
    };
}

function buildDeclarationRegistry(
    authority: ApiAuthority,
    declarations: readonly CanonicalApiDeclarationEvidence[],
): CanonicalApiRegistryBuildResult {
    const descriptors: CanonicalApiDescriptor[] = [];
    const diagnostics: CanonicalApiRegistryDiagnostic[] = [];
    for (const declaration of declarations) {
        const result = authority === "official"
            ? fromOfficialDeclaration(declaration)
            : (authority === "project" ? fromProjectDeclaration(declaration) : fromThirdPartyDeclaration(declaration));
        if (result.status === "accepted") {
            descriptors.push(result.descriptor);
            continue;
        }
        diagnostics.push(diagnostic("error", result.reason, result.reason, undefined, result.evidence));
    }
    const validation = validateCanonicalApiRegistrySnapshot({
        kind: "canonical_api_registry",
        authority,
        generatedAt: new Date().toISOString(),
        descriptors,
        diagnostics,
    });
    return {
        ok: diagnostics.length === 0 && validation.ok,
        authority,
        descriptors,
        diagnostics: [...diagnostics, ...validation.diagnostics],
    };
}

function mergeRegistryBuildResults(
    authority: ApiAuthority | "mixed",
    results: CanonicalApiRegistryBuildResult[],
): CanonicalApiRegistryBuildResult {
    const descriptors = results.flatMap(result => result.descriptors);
    const diagnostics = results.flatMap(result => result.diagnostics);
    const validation = validateCanonicalApiRegistrySnapshot({
        kind: "canonical_api_registry",
        authority,
        generatedAt: new Date().toISOString(),
        descriptors,
        diagnostics,
    });
    return {
        ok: diagnostics.length === 0 && validation.ok,
        authority,
        descriptors,
        diagnostics: [...diagnostics, ...validation.diagnostics],
    };
}

function validateDescriptor(
    descriptor: CanonicalApiDescriptor,
    seen: Map<string, string>,
    diagnostics: CanonicalApiRegistryDiagnostic[],
): void {
    if (!descriptor || typeof descriptor !== "object") {
        diagnostics.push(diagnostic("error", "descriptor_invalid", "descriptor must be an object"));
        return;
    }
    try {
        assertValidCanonicalApiId(descriptor.canonicalApiId);
    } catch (error) {
        diagnostics.push(diagnostic(
            "error",
            "descriptor_canonical_id_invalid",
            error instanceof Error ? error.message : String(error),
            descriptor.canonicalApiId,
        ));
        return;
    }
    try {
        const expected = buildCanonicalApiId({ ...descriptor, canonicalApiId: undefined } as Omit<CanonicalApiDescriptor, "canonicalApiId">);
        if (expected !== descriptor.canonicalApiId) {
            diagnostics.push(diagnostic(
                "error",
                "descriptor_canonical_id_mismatch",
                `descriptor canonicalApiId does not match descriptor fields: ${descriptor.canonicalApiId}`,
                descriptor.canonicalApiId,
            ));
        }
    } catch (error) {
        diagnostics.push(diagnostic(
            "error",
            "descriptor_rebuild_failed",
            error instanceof Error ? error.message : String(error),
            descriptor.canonicalApiId,
        ));
    }
    const previous = seen.get(descriptor.canonicalApiId);
    const current = JSON.stringify(descriptor);
    if (previous && previous !== current) {
        diagnostics.push(diagnostic(
            "error",
            "descriptor_collision",
            `canonicalApiId maps to conflicting descriptors: ${descriptor.canonicalApiId}`,
            descriptor.canonicalApiId,
        ));
    }
    if (previous === current) {
        diagnostics.push(diagnostic(
            "error",
            "descriptor_duplicate",
            `duplicate canonicalApiId descriptor: ${descriptor.canonicalApiId}`,
            descriptor.canonicalApiId,
        ));
    }
    seen.set(descriptor.canonicalApiId, current);
}

function diagnostic(
    severity: CanonicalApiRegistryDiagnostic["severity"],
    code: string,
    message: string,
    canonicalApiId?: string,
    evidence?: IdentityEvidence[],
): CanonicalApiRegistryDiagnostic {
    return {
        severity,
        code,
        message,
        canonicalApiId,
        evidence,
    };
}

function isSnapshotAuthority(value: unknown): value is ApiAuthority | "mixed" {
    return value === "official" || value === "project" || value === "third_party" || value === "mixed";
}
