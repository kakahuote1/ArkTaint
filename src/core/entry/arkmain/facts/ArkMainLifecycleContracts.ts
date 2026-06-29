import type { ArkMainOfficialLifecycleDeclaration } from "../catalog/ArkMainOfficialDeclarationCatalog";
import type {
    ArkMainFactKind,
    ArkMainOwnerKind,
    ArkMainPhaseName,
} from "../ArkMainTypes";

export interface ArkMainLifecycleContractMatch {
    phase: ArkMainPhaseName;
    kind: Extract<ArkMainFactKind, "ability_lifecycle" | "stage_lifecycle" | "extension_lifecycle" | "process_lifecycle" | "page_build" | "page_lifecycle">;
    ownerKind: ArkMainOwnerKind;
    entryFamily: string;
    entryShape: string;
    reason: string;
}

export interface ArkMainHandoffContractMatch {
    phase: Extract<ArkMainPhaseName, "reactive_handoff">;
    kind: Extract<ArkMainFactKind, "want_handoff">;
    ownerKind: ArkMainOwnerKind;
    entryFamily: string;
    entryShape: string;
    reason: string;
}

export function resolveOfficialLifecycleContract(
    declaration: ArkMainOfficialLifecycleDeclaration,
): ArkMainLifecycleContractMatch | null {
    const phase = normalizePhase(declaration.phase);
    const ownerKind = normalizeOwnerKind(declaration.ownerKind);
    const kind = normalizeLifecycleFactKind(declaration.entryKind);
    if (!phase || !kind || !ownerKind) {
        return null;
    }
    return {
        phase,
        kind,
        ownerKind,
        entryFamily: declaration.entryFamily || declaration.entryKind || kind,
        entryShape: declaration.entryShape || "official_declaration_method",
        reason: `Official arkmain declaration ${declaration.canonicalApiId}`,
    };
}

export function resolveOfficialHandoffContract(
    declaration: ArkMainOfficialLifecycleDeclaration,
): ArkMainHandoffContractMatch | null {
    const kind = declaration.entryKind === "want_handoff"
        ? "want_handoff"
        : undefined;
    const ownerKind = normalizeOwnerKind(declaration.ownerKind);
    if (!kind || !ownerKind) {
        return null;
    }
    return {
        phase: "reactive_handoff",
        kind,
        ownerKind,
        entryFamily: declaration.entryFamily || kind,
        entryShape: declaration.entryShape || "lifecycle_slot",
        reason: `Official arkmain handoff declaration ${declaration.canonicalApiId}`,
    };
}

function normalizePhase(value: string): ArkMainPhaseName | undefined {
    switch (value) {
        case "bootstrap":
        case "composition":
        case "interaction":
        case "reactive_handoff":
        case "teardown":
            return value;
        default:
            return undefined;
    }
}

function normalizeLifecycleFactKind(
    value: string,
): ArkMainLifecycleContractMatch["kind"] | undefined {
    switch (value) {
        case "ability_lifecycle":
        case "stage_lifecycle":
        case "extension_lifecycle":
        case "process_lifecycle":
        case "page_build":
        case "page_lifecycle":
            return value;
        default:
            return undefined;
    }
}

function normalizeOwnerKind(value: string | undefined): ArkMainOwnerKind | undefined {
    switch (String(value || "").trim()) {
        case "ability_owner":
        case "stage_owner":
        case "extension_owner":
        case "child_process_owner":
        case "component_owner":
        case "builder_owner":
        case "unknown_owner":
            return String(value || "").trim() as ArkMainOwnerKind;
        default:
            return undefined;
    }
}
