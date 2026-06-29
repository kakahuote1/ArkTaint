import type {
    ApiAuthority,
    ApiDomain,
    ArkanalyzerMethodKey,
    CanonicalApiDescriptor,
    CanonicalDeclarationOwnerKind,
    CanonicalExportPath,
    CanonicalInvokeKind,
    CanonicalMemberKind,
    CanonicalParameter,
    CanonicalType,
    IdentityEvidence,
} from "./CanonicalApiDescriptor";
import { buildCanonicalApiId } from "./CanonicalApiId";
import { isKnownArkanalyzerMethodKey } from "./ArkanalyzerMethodKey";
import type { CanonicalApiRegistry } from "./CanonicalApiRegistry";
import type { ImportMemberKey } from "./ImportMemberKey";
import type { ArkUiChainKey } from "./ArkUiChainKey";

export type CanonicalApiDescriptorBuildResult =
    | {
        status: "accepted";
        descriptor: CanonicalApiDescriptor;
        evidence: IdentityEvidence[];
    }
    | {
        status: "rejected";
        reason: string;
        evidence: IdentityEvidence[];
    };

export interface CanonicalApiDeclarationEvidence {
    domain: ApiDomain;
    moduleSpecifier: string;
    logicalDeclarationFile: string;
    exportPath: CanonicalExportPath[];
    declarationOwner: {
        kind: CanonicalDeclarationOwnerKind;
        path: string[];
        normalizedName: string;
        arkanalyzerName?: string;
    };
    member: {
        kind: CanonicalMemberKind;
        name: string;
        static?: boolean;
    };
    invoke: {
        kind: CanonicalInvokeKind;
    };
    signature: {
        parameters: CanonicalParameter[];
        returnType: CanonicalType;
    };
    arkanalyzer?: ArkanalyzerMethodKey;
    declarationLocations?: Array<{ file: string; line?: number; column?: number }>;
}

export interface ArkanalyzerMethodDescriptorContext {
    authority: ApiAuthority;
    domain: ApiDomain;
    moduleSpecifier?: string;
    exportPath: CanonicalExportPath[];
    declarationLocations?: Array<{ file: string; line?: number; column?: number }>;
}

export function fromOfficialDeclaration(evidence: CanonicalApiDeclarationEvidence): CanonicalApiDescriptorBuildResult {
    return buildFromDeclaration("official", "official-declaration", evidence);
}

export function fromProjectDeclaration(evidence: CanonicalApiDeclarationEvidence): CanonicalApiDescriptorBuildResult {
    return buildFromDeclaration("project", "project-declaration", evidence);
}

export function fromThirdPartyDeclaration(evidence: CanonicalApiDeclarationEvidence): CanonicalApiDescriptorBuildResult {
    return buildFromDeclaration("third_party", "third-party-declaration", evidence);
}

export function fromReviewedProjectAsset(evidence: CanonicalApiDeclarationEvidence): CanonicalApiDescriptorBuildResult {
    return buildFromDeclaration("project", "reviewed-project-asset", evidence);
}

export function fromArkanalyzerMethodKey(
    key: ArkanalyzerMethodKey,
    context: ArkanalyzerMethodDescriptorContext,
): CanonicalApiDescriptorBuildResult {
    if (!isKnownArkanalyzerMethodKey(key) || hasPlaceholderTypeText(key.returnType) || key.parameterTypes.some(hasPlaceholderTypeText)) {
        return rejected("arkanalyzer_method_key_contains_unknown", { key });
    }
    if (!context.authority || !context.domain || !Array.isArray(context.exportPath) || context.exportPath.length === 0) {
        return rejected("arkanalyzer_method_context_incomplete", { key, context });
    }
    const file = normalizeLogicalFile(key.declaringFileName);
    const methodName = String(key.methodName || "").trim();
    const isConstructor = methodName === "constructor";
    return buildFromDeclaration(context.authority, provenanceSourceForAuthority(context.authority), {
        domain: context.domain,
        moduleSpecifier: normalizeModuleSpecifier(context.moduleSpecifier || file),
        logicalDeclarationFile: file,
        exportPath: context.exportPath,
        declarationOwner: {
            kind: "class",
            path: [...(key.declaringNamespacePath || []), key.declaringClassName].filter(Boolean),
            normalizedName: key.declaringClassName,
            arkanalyzerName: key.declaringClassName,
        },
        member: isConstructor
            ? { kind: "constructor", name: "constructor" }
            : { kind: "method", name: methodName, static: !!key.staticFlag },
        invoke: { kind: isConstructor ? "new" : "call" },
        signature: {
            parameters: key.parameterTypes.map((type, index) => ({ index, type: { text: type } })),
            returnType: { text: key.returnType },
        },
        arkanalyzer: key,
        declarationLocations: context.declarationLocations || [{ file }],
    });
}

export function fromImportMemberKey(
    key: ImportMemberKey,
    registry: Pick<CanonicalApiRegistry, "resolveImportMemberKey" | "get">,
): CanonicalApiDescriptorBuildResult {
    const resolution = registry.resolveImportMemberKey(key);
    if (resolution.status !== "accepted" || !resolution.canonicalApiId) {
        return {
            status: "rejected",
            reason: resolution.reason,
            evidence: resolution.evidence,
        };
    }
    const descriptor = registry.get(resolution.canonicalApiId);
    return descriptor
        ? accepted(descriptor, resolution.evidence)
        : rejected("import_member_key_resolved_descriptor_missing", { key, canonicalApiId: resolution.canonicalApiId });
}

export function fromArkUiChainKey(
    key: ArkUiChainKey,
    registry: Pick<CanonicalApiRegistry, "resolveArkUiChainKey" | "get">,
): CanonicalApiDescriptorBuildResult {
    const resolution = registry.resolveArkUiChainKey(key);
    if (resolution.status !== "accepted" || !resolution.canonicalApiId) {
        return {
            status: "rejected",
            reason: resolution.reason,
            evidence: resolution.evidence,
        };
    }
    const descriptor = registry.get(resolution.canonicalApiId);
    return descriptor
        ? accepted(descriptor, resolution.evidence)
        : rejected("arkui_chain_key_resolved_descriptor_missing", { key, canonicalApiId: resolution.canonicalApiId });
}

function buildFromDeclaration(
    authority: ApiAuthority,
    provenanceSource: CanonicalApiDescriptor["provenance"]["source"],
    evidence: CanonicalApiDeclarationEvidence,
): CanonicalApiDescriptorBuildResult {
    const failure = validateDeclarationEvidence(authority, evidence);
    if (failure) return failure;
    const descriptorInput: Omit<CanonicalApiDescriptor, "canonicalApiId"> = {
        authority,
        domain: evidence.domain,
        moduleSpecifier: normalizeModuleSpecifier(evidence.moduleSpecifier),
        logicalDeclarationFile: normalizeLogicalFile(evidence.logicalDeclarationFile),
        exportPath: evidence.exportPath,
        declarationOwner: evidence.declarationOwner,
        member: evidence.member,
        invoke: evidence.invoke,
        signature: evidence.signature,
        arkanalyzer: evidence.arkanalyzer,
        provenance: {
            source: provenanceSource,
            declarationLocations: evidence.declarationLocations || [{ file: normalizeLogicalFile(evidence.logicalDeclarationFile) }],
        },
    };
    try {
        const canonicalApiId = buildCanonicalApiId(descriptorInput);
        return accepted({ canonicalApiId, ...descriptorInput }, [{
            kind: "canonical_descriptor_built",
            message: "canonical_descriptor_built",
            data: { canonicalApiId, authority, moduleSpecifier: descriptorInput.moduleSpecifier },
        }]);
    } catch (error) {
        return rejected("canonical_descriptor_id_invalid", {
            error: error instanceof Error ? error.message : String(error),
            evidence,
        });
    }
}

function validateDeclarationEvidence(
    authority: ApiAuthority,
    evidence: CanonicalApiDeclarationEvidence,
): CanonicalApiDescriptorBuildResult | undefined {
    if (!authority) return rejected("canonical_descriptor_authority_missing", { evidence });
    for (const [field, value] of [
        ["domain", evidence.domain],
        ["moduleSpecifier", evidence.moduleSpecifier],
        ["logicalDeclarationFile", evidence.logicalDeclarationFile],
    ] as const) {
        if (hasUnknownIdentityEvidence(value)) return rejected(`canonical_descriptor_${field}_invalid`, { evidence });
    }
    if (isAbsoluteLocalPath(evidence.logicalDeclarationFile)) {
        return rejected("canonical_descriptor_file_must_be_logical", { evidence });
    }
    if (!Array.isArray(evidence.exportPath) || evidence.exportPath.length === 0) {
        return rejected("canonical_descriptor_export_path_missing", { evidence });
    }
    for (const part of evidence.exportPath) {
        if (hasUnknownIdentityEvidence(part.kind) || hasUnknownIdentityEvidence(part.name)) {
            return rejected("canonical_descriptor_export_path_invalid", { evidence });
        }
    }
    if (hasUnknownIdentityEvidence(evidence.declarationOwner.kind)
        || hasUnknownIdentityEvidence(evidence.declarationOwner.normalizedName)
        || !Array.isArray(evidence.declarationOwner.path)
        || evidence.declarationOwner.path.length === 0
        || evidence.declarationOwner.path.some(hasUnknownIdentityEvidence)) {
        return rejected("canonical_descriptor_owner_invalid", { evidence });
    }
    if (evidence.member.kind === "method" && typeof evidence.member.static !== "boolean") {
        return rejected("canonical_descriptor_method_static_flag_missing", { evidence });
    }
    if (evidence.member.kind === "constructor" && evidence.member.name !== "constructor") {
        return rejected("canonical_descriptor_constructor_member_must_be_constructor", { evidence });
    }
    if (hasUnknownIdentityEvidence(evidence.member.kind) || hasUnknownIdentityEvidence(evidence.member.name)) {
        return rejected("canonical_descriptor_member_invalid", { evidence });
    }
    if (hasUnknownIdentityEvidence(evidence.invoke.kind)) {
        return rejected("canonical_descriptor_invoke_invalid", { evidence });
    }
    const parameterIndexes = new Set<number>();
    for (const parameter of evidence.signature.parameters || []) {
        if (!Number.isInteger(parameter.index) || parameter.index < 0 || parameterIndexes.has(parameter.index)) {
            return rejected("canonical_descriptor_parameter_index_invalid", { evidence });
        }
        parameterIndexes.add(parameter.index);
        if (hasPlaceholderTypeText(parameter.type?.text)) {
            return rejected("canonical_descriptor_parameter_type_unknown", { evidence });
        }
    }
    for (let index = 0; index < parameterIndexes.size; index++) {
        if (!parameterIndexes.has(index)) {
            return rejected("canonical_descriptor_parameter_index_sparse", { evidence });
        }
    }
    if (hasPlaceholderTypeText(evidence.signature.returnType?.text)) {
        return rejected("canonical_descriptor_return_type_unknown", { evidence });
    }
    if (evidence.arkanalyzer && !isKnownArkanalyzerMethodKey(evidence.arkanalyzer)) {
        return rejected("canonical_descriptor_arkanalyzer_key_unknown", { evidence });
    }
    return undefined;
}

function accepted(descriptor: CanonicalApiDescriptor, evidence: IdentityEvidence[]): CanonicalApiDescriptorBuildResult {
    return {
        status: "accepted",
        descriptor,
        evidence,
    };
}

function rejected(reason: string, data: Record<string, unknown>): CanonicalApiDescriptorBuildResult {
    return {
        status: "rejected",
        reason,
        evidence: [{ kind: reason, message: reason, data }],
    };
}

function provenanceSourceForAuthority(authority: ApiAuthority): CanonicalApiDescriptor["provenance"]["source"] {
    if (authority === "official") return "official-declaration";
    if (authority === "third_party") return "third-party-declaration";
    return "project-declaration";
}

function normalizeModuleSpecifier(value: string): string {
    return String(value || "").replace(/\\/g, "/").trim();
}

function normalizeLogicalFile(value: string): string {
    return normalizeModuleSpecifier(value).replace(/^@/, "");
}

function isAbsoluteLocalPath(value: string): boolean {
    const text = String(value || "");
    return /^[A-Za-z]:[\\/]/.test(text) || text.startsWith("\\\\");
}

function hasUnknownIdentityEvidence(value: unknown): boolean {
    const text = String(value || "").trim().toLowerCase();
    if (!text) return true;
    if (text === "unknown" || text === "%unk" || text === "@unk" || text === "@%unk/%unk") return true;
    return text.includes("%unk") || text.includes("@unk");
}

function hasPlaceholderTypeText(value: unknown): boolean {
    const text = String(value || "").trim().toLowerCase();
    if (!text) return true;
    if (text === "%unk" || text === "@unk" || text === "@%unk/%unk") return true;
    return text.includes("%unk") || text.includes("@unk");
}
