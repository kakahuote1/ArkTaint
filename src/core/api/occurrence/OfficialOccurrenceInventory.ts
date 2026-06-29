import type { CanonicalApiDescriptor, CanonicalApiRegistry } from "../identity";
import type { RawApiOccurrence, ResolvedApiOccurrence } from "./ApiOccurrence";
import {
    buildOfficialOccurrenceEvidenceGraph,
    type OfficialOccurrenceEvidenceGraph,
} from "./OfficialOccurrenceEvidenceGraph";

export type OfficialOccurrenceSyntaxKind =
    | "call"
    | "new"
    | "property-read"
    | "property-write"
    | "decorator"
    | "arkui-component";

export type OfficialOccurrenceStatus = ResolvedApiOccurrence["status"];

export interface OfficialOccurrenceEvidenceSummary {
    readonly rawMethodSignature?: string;
    readonly rawArkanalyzerMethodKey?: RawApiOccurrence["ir"]["arkanalyzerMethodKey"];
    readonly unknownSignature: boolean;
    readonly receiverText?: string;
    readonly memberName?: string;
    readonly argCount?: number;
    readonly argTypes?: string[];
    readonly resultText?: string;
    readonly resultUseKind?: RawApiOccurrence["ir"]["resultUseKind"];
    readonly importBinding?: {
        readonly moduleSpecifier: string;
        readonly importKind: string;
        readonly importedName: string;
        readonly localBindingId: string;
        readonly localName: string;
        readonly aliasChain: string[];
        readonly memberChain: string[];
        readonly invokeKind: string;
        readonly arity: number;
        readonly shadowed: boolean;
        readonly parameterTypes?: string[];
        readonly returnType?: string;
        readonly literalKinds?: Array<{ index: number; kind: string }>;
        readonly objectKeys?: Array<{ index: number; keys: string[] }>;
        readonly callbackPositions?: number[];
        readonly spreadPositions?: number[];
    };
    readonly receiverBinding?: {
        readonly moduleSpecifier: string;
        readonly receiverType: string;
        readonly memberName: string;
        readonly invokeKind: string;
        readonly arity: number;
        readonly sourceFile: string;
        readonly localName: string;
        readonly producerOccurrenceId?: string;
        readonly producerCanonicalApiId?: string;
        readonly producerMemberName?: string;
        readonly parameterTypes?: string[];
        readonly returnType?: string;
        readonly literalKinds?: Array<{ index: number; kind: string }>;
        readonly objectKeys?: Array<{ index: number; keys: string[] }>;
        readonly callbackPositions?: number[];
        readonly spreadPositions?: number[];
    };
    readonly receiverAmbiguity?: RawApiOccurrence["receiverAmbiguityEvidence"];
    readonly arkuiEvidence?: RawApiOccurrence["arkuiEvidence"];
    readonly arkuiComponentEvidence?: RawApiOccurrence["arkuiComponentEvidence"];
    readonly decoratorEvidence?: RawApiOccurrence["decoratorEvidence"];
    readonly projectEvidence?: RawApiOccurrence["projectEvidence"];
    readonly officialEvidence?: RawApiOccurrence["officialEvidence"];
}

export interface OfficialOccurrenceRecord {
    readonly occurrenceId: string;
    readonly rawOccurrenceId: string;
    readonly sourceFile: string;
    readonly sourceLocation: {
        readonly line?: number;
        readonly column?: number;
    };
    readonly enclosingMethodSignature?: string;
    readonly statementText?: string;
    readonly syntaxKind: OfficialOccurrenceSyntaxKind;
    readonly status: OfficialOccurrenceStatus;
    readonly canonicalApiId?: string;
    readonly resolutionKind?: ResolvedApiOccurrence["resolutionKind"];
    readonly reasonCode: string;
    readonly candidates: string[];
    readonly officialBasis: string[];
    readonly descriptor?: {
        readonly authority: CanonicalApiDescriptor["authority"];
        readonly domain: CanonicalApiDescriptor["domain"];
        readonly moduleSpecifier: string;
        readonly logicalDeclarationFile: string;
        readonly ownerKind: string;
        readonly ownerPath: string[];
        readonly memberKind: string;
        readonly memberName: string;
        readonly invokeKind: string;
    };
    readonly evidence: OfficialOccurrenceEvidenceSummary;
    readonly evidenceGraph: OfficialOccurrenceEvidenceGraph;
}

export interface OfficialOccurrenceCoverageSnapshot {
    readonly totalOccurrenceCount: number;
    readonly acceptedCount: number;
    readonly unresolvedCount: number;
    readonly ambiguousCount: number;
    readonly rejectedCount: number;
    readonly byStatus: Record<OfficialOccurrenceStatus, number>;
    readonly bySyntaxKind: Record<string, number>;
    readonly byReasonCode: Record<string, number>;
    readonly bySourceFile: Record<string, number>;
    readonly byDomain: Record<string, number>;
    readonly byModuleSpecifier: Record<string, number>;
    readonly byResolutionKind: Record<string, number>;
    readonly acceptedCanonicalApiIds: number;
}

export function buildOfficialOccurrenceRecords(input: {
    rawOccurrences: readonly RawApiOccurrence[];
    resolvedOccurrences: readonly ResolvedApiOccurrence[];
    canonicalApiRegistry: CanonicalApiRegistry;
}): OfficialOccurrenceRecord[] {
    const resolvedByRawId = new Map(input.resolvedOccurrences.map(item => [item.rawOccurrenceId, item]));
    const officialModules = new Set<string>();
    const officialDeclarationFiles = new Set<string>();
    for (const descriptor of input.canonicalApiRegistry.listDescriptors()) {
        if (descriptor.authority !== "official") continue;
        if (descriptor.moduleSpecifier) officialModules.add(normalizeEvidencePath(descriptor.moduleSpecifier));
        if (descriptor.logicalDeclarationFile) officialDeclarationFiles.add(normalizeEvidencePath(descriptor.logicalDeclarationFile));
        if (descriptor.arkanalyzer?.declaringFileName) {
            officialDeclarationFiles.add(normalizeEvidencePath(descriptor.arkanalyzer.declaringFileName));
        }
    }

    const out: OfficialOccurrenceRecord[] = [];
    for (const raw of input.rawOccurrences) {
        const resolved = resolvedByRawId.get(raw.rawOccurrenceId);
        if (!resolved) continue;
        const descriptor = resolved.canonicalApiId
            ? input.canonicalApiRegistry.get(resolved.canonicalApiId)
            : undefined;
        const officialBasis = officialBasisForRaw(raw, descriptor, officialModules, officialDeclarationFiles);
        if (officialBasis.length === 0) continue;
        out.push({
            occurrenceId: resolved.occurrenceId,
            rawOccurrenceId: raw.rawOccurrenceId,
            sourceFile: raw.sourceLocation.file,
            sourceLocation: {
                line: raw.sourceLocation.line,
                column: raw.sourceLocation.column,
            },
            enclosingMethodSignature: raw.enclosingMethodSignature,
            statementText: raw.statementText,
            syntaxKind: syntaxKindForRaw(raw),
            status: resolved.status,
            canonicalApiId: resolved.canonicalApiId,
            resolutionKind: resolved.resolutionKind,
            reasonCode: resolved.reason,
            candidates: [...(resolved.candidates || [])],
            officialBasis,
            descriptor: descriptor ? descriptorSummary(descriptor) : undefined,
            evidence: evidenceSummary(raw),
            evidenceGraph: buildOfficialOccurrenceEvidenceGraph(raw, resolved),
        });
    }
    return out.sort(compareOfficialOccurrenceRecord);
}

export function emptyOfficialOccurrenceCoverageSnapshot(): OfficialOccurrenceCoverageSnapshot {
    return {
        totalOccurrenceCount: 0,
        acceptedCount: 0,
        unresolvedCount: 0,
        ambiguousCount: 0,
        rejectedCount: 0,
        byStatus: {
            accepted: 0,
            unresolved: 0,
            ambiguous: 0,
            rejected: 0,
        },
        bySyntaxKind: {},
        byReasonCode: {},
        bySourceFile: {},
        byDomain: {},
        byModuleSpecifier: {},
        byResolutionKind: {},
        acceptedCanonicalApiIds: 0,
    };
}

export function summarizeOfficialOccurrenceCoverage(
    records: readonly OfficialOccurrenceRecord[],
): OfficialOccurrenceCoverageSnapshot {
    const snapshot = emptyOfficialOccurrenceCoverageSnapshot();
    const acceptedIds = new Set<string>();
    for (const record of records) {
        increment(snapshot.byStatus, record.status);
        increment(snapshot.bySyntaxKind, record.syntaxKind);
        increment(snapshot.byReasonCode, record.reasonCode || "unknown_reason");
        increment(snapshot.bySourceFile, record.sourceFile || "unknown_file");
        increment(snapshot.byDomain, record.descriptor?.domain || "unknown_domain");
        if (record.resolutionKind) increment(snapshot.byResolutionKind, record.resolutionKind);
        const moduleSpecifier = record.evidence.importBinding?.moduleSpecifier
            || record.descriptor?.moduleSpecifier
            || "unknown_module";
        increment(snapshot.byModuleSpecifier, moduleSpecifier);
        if (record.status === "accepted" && record.canonicalApiId) acceptedIds.add(record.canonicalApiId);
    }
    return {
        ...snapshot,
        totalOccurrenceCount: records.length,
        acceptedCount: snapshot.byStatus.accepted,
        unresolvedCount: snapshot.byStatus.unresolved,
        ambiguousCount: snapshot.byStatus.ambiguous,
        rejectedCount: snapshot.byStatus.rejected,
        acceptedCanonicalApiIds: acceptedIds.size,
    };
}

function officialBasisForRaw(
    raw: RawApiOccurrence,
    descriptor: CanonicalApiDescriptor | undefined,
    officialModules: ReadonlySet<string>,
    officialDeclarationFiles: ReadonlySet<string>,
): string[] {
    const basis = new Set<string>();
    if (descriptor?.authority === "official") {
        basis.add("resolved_official_descriptor");
    }
    const moduleSpecifier = normalizeEvidencePath(raw.importEvidence?.moduleSpecifier);
    if (moduleSpecifier && officialModules.has(moduleSpecifier)) {
        basis.add("official_import_module");
    }
    const receiverModuleSpecifier = normalizeEvidencePath(raw.receiverEvidence?.moduleSpecifier);
    if (receiverModuleSpecifier && officialModules.has(receiverModuleSpecifier)) {
        basis.add("official_receiver_module");
    }
    if (raw.arkuiEvidence) {
        basis.add("arkui_registry_evidence");
    }
    if (raw.arkuiComponentEvidence) {
        basis.add("arkui_component_registry_evidence");
    }
    if (raw.decoratorEvidence) {
        basis.add("decorator_registry_evidence");
    }
    if ((raw.officialEvidence || []).some(item => item.kind === "arkui-component")) {
        basis.add("arkui_component_registry_evidence");
    }
    if ((raw.officialEvidence || []).some(item => item.kind === "decorator")) {
        basis.add("decorator_registry_evidence");
    }
    const declaringFileName = normalizeEvidencePath(raw.ir.arkanalyzerMethodKey?.declaringFileName);
    if (declaringFileName && officialDeclarationFiles.has(declaringFileName)) {
        basis.add("official_declaration_file_evidence");
    }
    return [...basis].sort();
}

function syntaxKindForRaw(raw: RawApiOccurrence): OfficialOccurrenceSyntaxKind {
    if (raw.importEvidence?.invokeKind === "new" || raw.kind === "construct") return "new";
    if (raw.importEvidence?.invokeKind === "property-write") return "property-write";
    if (raw.ir.propertyAccessKind === "write") return "property-write";
    if (raw.importEvidence?.invokeKind === "property-read" || raw.kind === "property-access") return "property-read";
    if (raw.kind === "decorator" || (raw.officialEvidence || []).some(item => item.kind === "decorator")) {
        return "decorator";
    }
    if (raw.kind === "component-chain" || (raw.officialEvidence || []).some(item => item.kind === "arkui-component")) {
        return "arkui-component";
    }
    return "call";
}

function descriptorSummary(descriptor: CanonicalApiDescriptor): OfficialOccurrenceRecord["descriptor"] {
    return {
        authority: descriptor.authority,
        domain: descriptor.domain,
        moduleSpecifier: descriptor.moduleSpecifier,
        logicalDeclarationFile: descriptor.logicalDeclarationFile,
        ownerKind: descriptor.declarationOwner.kind,
        ownerPath: [...descriptor.declarationOwner.path],
        memberKind: descriptor.member.kind,
        memberName: descriptor.member.name,
        invokeKind: descriptor.invoke.kind,
    };
}

function evidenceSummary(raw: RawApiOccurrence): OfficialOccurrenceEvidenceSummary {
    return {
        rawMethodSignature: raw.ir.methodSignatureText,
        rawArkanalyzerMethodKey: raw.ir.arkanalyzerMethodKey,
        unknownSignature: raw.ir.unknownSignature,
        receiverText: raw.ir.receiverText,
        memberName: raw.ir.memberName,
        argCount: raw.ir.argCount,
        argTypes: raw.ir.argTypes ? [...raw.ir.argTypes] : undefined,
        resultText: raw.ir.resultText,
        resultUseKind: raw.ir.resultUseKind,
        importBinding: raw.importEvidence ? {
            moduleSpecifier: raw.importEvidence.moduleSpecifier,
            importKind: raw.importEvidence.importKind,
            importedName: raw.importEvidence.importedName,
            localBindingId: raw.importEvidence.localBindingId,
            localName: raw.importEvidence.localName,
            aliasChain: [...raw.importEvidence.aliasChain],
            memberChain: [...raw.importEvidence.memberChain],
            invokeKind: raw.importEvidence.invokeKind,
            arity: raw.importEvidence.argShape.arity,
            shadowed: raw.importEvidence.scopeEvidence.shadowed,
            parameterTypes: raw.importEvidence.argShape.parameterTypes
                ? [...raw.importEvidence.argShape.parameterTypes]
                : undefined,
            returnType: raw.importEvidence.argShape.returnType,
            literalKinds: raw.importEvidence.argShape.literalKinds
                ? raw.importEvidence.argShape.literalKinds.map(item => ({ ...item }))
                : undefined,
            objectKeys: raw.importEvidence.argShape.objectKeys
                ? raw.importEvidence.argShape.objectKeys.map(item => ({ index: item.index, keys: [...item.keys] }))
                : undefined,
            callbackPositions: raw.importEvidence.argShape.callbackPositions
                ? [...raw.importEvidence.argShape.callbackPositions]
                : undefined,
            spreadPositions: raw.importEvidence.argShape.spreadPositions
                ? [...raw.importEvidence.argShape.spreadPositions]
                : undefined,
        } : undefined,
        receiverBinding: raw.receiverEvidence ? {
            moduleSpecifier: raw.receiverEvidence.moduleSpecifier,
            receiverType: raw.receiverEvidence.receiverType,
            memberName: raw.receiverEvidence.memberName,
            invokeKind: raw.receiverEvidence.invokeKind,
            arity: raw.receiverEvidence.argShape.arity,
            sourceFile: raw.receiverEvidence.provenance.sourceFile,
            localName: raw.receiverEvidence.provenance.localName,
            producerOccurrenceId: raw.receiverEvidence.provenance.producerOccurrenceId,
            producerCanonicalApiId: raw.receiverEvidence.provenance.producerCanonicalApiId,
            producerMemberName: raw.receiverEvidence.provenance.producerMemberName,
            parameterTypes: raw.receiverEvidence.argShape.parameterTypes
                ? [...raw.receiverEvidence.argShape.parameterTypes]
                : undefined,
            returnType: raw.receiverEvidence.argShape.returnType,
            literalKinds: raw.receiverEvidence.argShape.literalKinds
                ? raw.receiverEvidence.argShape.literalKinds.map(item => ({ ...item }))
                : undefined,
            objectKeys: raw.receiverEvidence.argShape.objectKeys
                ? raw.receiverEvidence.argShape.objectKeys.map(item => ({ index: item.index, keys: [...item.keys] }))
                : undefined,
            callbackPositions: raw.receiverEvidence.argShape.callbackPositions
                ? [...raw.receiverEvidence.argShape.callbackPositions]
                : undefined,
            spreadPositions: raw.receiverEvidence.argShape.spreadPositions
                ? [...raw.receiverEvidence.argShape.spreadPositions]
                : undefined,
        } : undefined,
        receiverAmbiguity: raw.receiverAmbiguityEvidence ? {
            localName: raw.receiverAmbiguityEvidence.localName,
            candidates: raw.receiverAmbiguityEvidence.candidates.map(item => ({ ...item })),
        } : undefined,
        arkuiEvidence: raw.arkuiEvidence ? { ...raw.arkuiEvidence } : undefined,
        arkuiComponentEvidence: raw.arkuiComponentEvidence ? {
            ...raw.arkuiComponentEvidence,
            argShape: {
                ...raw.arkuiComponentEvidence.argShape,
                parameterTypes: raw.arkuiComponentEvidence.argShape.parameterTypes
                    ? [...raw.arkuiComponentEvidence.argShape.parameterTypes]
                    : undefined,
                literalKinds: raw.arkuiComponentEvidence.argShape.literalKinds
                    ? raw.arkuiComponentEvidence.argShape.literalKinds.map(item => ({ ...item }))
                    : undefined,
                literalValues: raw.arkuiComponentEvidence.argShape.literalValues
                    ? raw.arkuiComponentEvidence.argShape.literalValues.map(item => ({ ...item }))
                    : undefined,
                objectKeys: raw.arkuiComponentEvidence.argShape.objectKeys
                    ? raw.arkuiComponentEvidence.argShape.objectKeys.map(item => ({ index: item.index, keys: [...item.keys] }))
                    : undefined,
                callbackPositions: raw.arkuiComponentEvidence.argShape.callbackPositions
                    ? [...raw.arkuiComponentEvidence.argShape.callbackPositions]
                    : undefined,
                spreadPositions: raw.arkuiComponentEvidence.argShape.spreadPositions
                    ? [...raw.arkuiComponentEvidence.argShape.spreadPositions]
                    : undefined,
            },
        } : undefined,
        decoratorEvidence: raw.decoratorEvidence ? { ...raw.decoratorEvidence } : undefined,
        officialEvidence: raw.officialEvidence ? raw.officialEvidence.map(item => ({ ...item })) : undefined,
        projectEvidence: raw.projectEvidence ? {
            ...raw.projectEvidence,
            exportPath: [...raw.projectEvidence.exportPath],
            ownerPath: [...raw.projectEvidence.ownerPath],
            parameterTypes: [...raw.projectEvidence.parameterTypes],
        } : undefined,
    };
}

function compareOfficialOccurrenceRecord(left: OfficialOccurrenceRecord, right: OfficialOccurrenceRecord): number {
    return left.sourceFile.localeCompare(right.sourceFile)
        || (left.sourceLocation.line || 0) - (right.sourceLocation.line || 0)
        || (left.sourceLocation.column || 0) - (right.sourceLocation.column || 0)
        || left.rawOccurrenceId.localeCompare(right.rawOccurrenceId);
}

function normalizeEvidencePath(value: unknown): string {
    return String(value || "").replace(/\\/g, "/").trim();
}

function increment<T extends string>(counter: Record<T, number>, key: T): void {
    counter[key] = (counter[key] || 0) + 1;
}
