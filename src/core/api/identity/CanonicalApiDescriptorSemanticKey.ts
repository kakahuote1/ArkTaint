import type { CanonicalApiDescriptor, CanonicalParameter } from "./CanonicalApiDescriptor";

export interface CanonicalApiDescriptorSemanticGroup {
    semanticKey: string;
    representativeCanonicalApiId: string;
    canonicalApiIds: string[];
    descriptors: CanonicalApiDescriptor[];
    declarationFiles: string[];
    memberName: string;
    parameterTypes: string[];
    returnType: string;
}

export interface CanonicalApiDescriptorMirrorReplacement {
    from: string;
    to: string;
    semanticKey: string;
    declarationFiles: string[];
}

export function canonicalApiDescriptorSemanticKey(descriptor: CanonicalApiDescriptor): string {
    return JSON.stringify({
        authority: descriptor.authority,
        domain: descriptor.domain,
        moduleSpecifier: descriptor.moduleSpecifier,
        exportPath: descriptor.exportPath.map(part => ({ kind: part.kind, name: part.name })),
        declarationOwner: {
            kind: descriptor.declarationOwner.kind,
            path: descriptor.declarationOwner.path,
            normalizedName: descriptor.declarationOwner.normalizedName,
        },
        member: {
            kind: descriptor.member.kind,
            name: descriptor.member.name,
            static: descriptor.member.static === true,
        },
        invokeKind: descriptor.invoke.kind,
        parameters: descriptor.signature.parameters
            .slice()
            .sort((left, right) => left.index - right.index)
            .map(parameterSemanticPart),
        returnType: descriptor.signature.returnType.text,
    });
}

export function canonicalApiDescriptorMirrorGroupKey(descriptor: CanonicalApiDescriptor): string {
    return canonicalApiDescriptorSemanticKey(descriptor);
}

export function canonicalApiDescriptorResolutionEquivalenceKey(descriptor: CanonicalApiDescriptor): string {
    return JSON.stringify({
        authority: descriptor.authority,
        domain: descriptor.domain,
        moduleSpecifier: descriptor.moduleSpecifier,
        exportPath: descriptor.exportPath.map(part => ({ kind: part.kind, name: part.name })),
        declarationOwner: resolutionEquivalenceDeclarationOwner(descriptor),
        member: {
            kind: descriptor.member.kind,
            name: descriptor.member.name,
            static: descriptor.member.static === true,
        },
        invokeKind: descriptor.invoke.kind,
        parameters: descriptor.signature.parameters
            .slice()
            .sort((left, right) => left.index - right.index)
            .map(parameter => resolutionEquivalenceParameterPart(descriptor, parameter)),
        returnType: descriptor.signature.returnType.text,
    });
}

export function isCanonicalApiDescriptorResolutionMirrorGroup(
    descriptors: readonly CanonicalApiDescriptor[],
): boolean {
    if (descriptors.length < 2) return false;
    if (isArkUiComponentCallOverloadGroup(descriptors)) return true;
    const declarationFamilies = new Set(descriptors
        .map(descriptor => declarationFileFamily(descriptor.logicalDeclarationFile))
        .filter(Boolean));
    if (!declarationFamilies.has("d.ets") || !declarationFamilies.has("d.ts")) return false;
    return descriptors.every(isTopLevelExportedFunctionMirrorDescriptor);
}

export function groupMirrorEquivalentDescriptors(
    descriptors: readonly CanonicalApiDescriptor[],
): CanonicalApiDescriptorSemanticGroup[] {
    const groups = new Map<string, CanonicalApiDescriptor[]>();
    for (const descriptor of descriptors) {
        const key = canonicalApiDescriptorMirrorGroupKey(descriptor);
        const current = groups.get(key) || [];
        current.push(descriptor);
        groups.set(key, current);
    }
    return [...groups.entries()]
        .map(([semanticKey, groupDescriptors]) => buildSemanticGroup(semanticKey, groupDescriptors))
        .sort((left, right) => left.semanticKey.localeCompare(right.semanticKey));
}

export function mirrorReplacementMapForDescriptors(
    descriptors: readonly CanonicalApiDescriptor[],
): Map<string, string> {
    const replacements = new Map<string, string>();
    for (const group of groupMirrorEquivalentDescriptors(descriptors)) {
        for (const canonicalApiId of group.canonicalApiIds) {
            if (canonicalApiId !== group.representativeCanonicalApiId) {
                replacements.set(canonicalApiId, group.representativeCanonicalApiId);
            }
        }
    }
    return replacements;
}

export function listMirrorReplacements(
    descriptors: readonly CanonicalApiDescriptor[],
): CanonicalApiDescriptorMirrorReplacement[] {
    const replacements: CanonicalApiDescriptorMirrorReplacement[] = [];
    for (const group of groupMirrorEquivalentDescriptors(descriptors)) {
        for (const canonicalApiId of group.canonicalApiIds) {
            if (canonicalApiId === group.representativeCanonicalApiId) continue;
            replacements.push({
                from: canonicalApiId,
                to: group.representativeCanonicalApiId,
                semanticKey: group.semanticKey,
                declarationFiles: group.declarationFiles,
            });
        }
    }
    return replacements.sort((left, right) => left.from.localeCompare(right.from));
}

function buildSemanticGroup(
    semanticKey: string,
    descriptors: CanonicalApiDescriptor[],
): CanonicalApiDescriptorSemanticGroup {
    const sortedDescriptors = descriptors
        .slice()
        .sort(compareDescriptorForRepresentative);
    const representative = sortedDescriptors[0];
    const canonicalApiIds = uniqueSorted(descriptors.map(descriptor => descriptor.canonicalApiId));
    return {
        semanticKey,
        representativeCanonicalApiId: representative.canonicalApiId,
        canonicalApiIds,
        descriptors: sortedDescriptors.map(descriptor => ({ ...descriptor })),
        declarationFiles: uniqueSorted(descriptors.map(descriptor => descriptor.logicalDeclarationFile)),
        memberName: representative.member.name,
        parameterTypes: representative.signature.parameters
            .slice()
            .sort((left, right) => left.index - right.index)
            .map(parameter => parameter.type.text),
        returnType: representative.signature.returnType.text,
    };
}

function compareDescriptorForRepresentative(left: CanonicalApiDescriptor, right: CanonicalApiDescriptor): number {
    return compareCanonicalApiDescriptorForRepresentative(left, right);
}

export function compareCanonicalApiDescriptorForRepresentative(
    left: CanonicalApiDescriptor,
    right: CanonicalApiDescriptor,
): number {
    return declarationFilePriority(left.logicalDeclarationFile) - declarationFilePriority(right.logicalDeclarationFile)
        || left.logicalDeclarationFile.localeCompare(right.logicalDeclarationFile)
        || left.canonicalApiId.localeCompare(right.canonicalApiId);
}

function declarationFilePriority(file: string): number {
    const normalized = String(file || "").replace(/\\/g, "/");
    if (normalized.endsWith(".d.ets")) return 0;
    if (normalized.endsWith(".d.ts")) return 1;
    return 2;
}

function parameterSemanticPart(parameter: CanonicalParameter): Record<string, unknown> {
    return {
        index: parameter.index,
        optional: parameter.optional === true,
        rest: parameter.rest === true,
        type: parameter.type.text,
    };
}

function resolutionEquivalenceParameterPart(
    descriptor: CanonicalApiDescriptor,
    parameter: CanonicalParameter,
): Record<string, unknown> {
    if (isArkUiComponentCallDescriptor(descriptor)) {
        return {
            index: parameter.index,
            optional: parameter.optional === true,
            rest: parameter.rest === true,
            type: "arkui-component-call-overload",
        };
    }
    return parameterSemanticPart(parameter);
}

function resolutionEquivalenceDeclarationOwner(descriptor: CanonicalApiDescriptor): Record<string, unknown> {
    if (isTopLevelExportedFunctionMirrorDescriptor(descriptor)) {
        return {
            kind: "export-container",
            path: descriptor.exportPath.map(part => `${part.kind}:${part.name}`),
            normalizedName: descriptor.exportPath.map(part => part.name).join("."),
        };
    }
    return {
        kind: descriptor.declarationOwner.kind,
        path: descriptor.declarationOwner.path,
        normalizedName: descriptor.declarationOwner.normalizedName,
    };
}

function isTopLevelExportedFunctionMirrorDescriptor(descriptor: CanonicalApiDescriptor): boolean {
    if (descriptor.authority !== "official") return false;
    if (descriptor.member.kind !== "function" || descriptor.invoke.kind !== "call") return false;
    const memberName = normalizeIdentityPart(descriptor.member.name);
    if (!memberName) return false;
    const ownerName = normalizeIdentityPart(descriptor.declarationOwner.normalizedName)
        || normalizeIdentityPart(descriptor.declarationOwner.path[descriptor.declarationOwner.path.length - 1]);
    if (!ownerName) return false;
    if (descriptor.declarationOwner.kind === "function") {
        return ownerName === memberName;
    }
    if (descriptor.declarationOwner.kind !== "namespace") return false;
    const exportedNames = new Set(descriptor.exportPath
        .map(part => normalizeIdentityPart(part.name))
        .filter(Boolean));
    return exportedNames.has(ownerName);
}

function isArkUiComponentCallOverloadGroup(descriptors: readonly CanonicalApiDescriptor[]): boolean {
    if (descriptors.length < 2) return false;
    if (!descriptors.every(isArkUiComponentCallDescriptor)) return false;
    const first = descriptors[0];
    const firstComponentName = arkUiComponentName(first);
    const firstParameterCount = first.signature.parameters.length;
    const sameSurface = descriptors.every(descriptor =>
        descriptor.authority === first.authority
        && descriptor.domain === first.domain
        && descriptor.moduleSpecifier === first.moduleSpecifier
        && descriptor.logicalDeclarationFile === first.logicalDeclarationFile
        && arkUiComponentName(descriptor) === firstComponentName
        && descriptor.declarationOwner.kind === first.declarationOwner.kind
        && descriptor.declarationOwner.normalizedName === first.declarationOwner.normalizedName
        && descriptor.member.kind === first.member.kind
        && descriptor.member.name === first.member.name
        && descriptor.member.static === first.member.static
        && descriptor.invoke.kind === first.invoke.kind
        && descriptor.signature.returnType.text === first.signature.returnType.text
        && descriptor.signature.parameters.length === firstParameterCount);
    if (!sameSurface) return false;
    return componentOverloadParameterSetsAreNested(descriptors);
}

function isArkUiComponentCallDescriptor(descriptor: CanonicalApiDescriptor): boolean {
    return descriptor.authority === "official"
        && descriptor.domain === "arkui"
        && Boolean(arkUiComponentName(descriptor))
        && descriptor.member.name === "call"
        && descriptor.invoke.kind === "call";
}

function arkUiComponentName(descriptor: CanonicalApiDescriptor): string {
    return descriptor.exportPath.find(part => part.kind === "component")?.name || "";
}

function componentOverloadParameterSetsAreNested(descriptors: readonly CanonicalApiDescriptor[]): boolean {
    const parameterCount = descriptors[0]?.signature.parameters.length || 0;
    for (let index = 0; index < parameterCount; index++) {
        const sets = descriptors.map(descriptor => parameterTypeAlternatives(descriptor.signature.parameters[index]?.type.text || ""));
        if (sets.some(set => set.size === 0)) return false;
        for (let left = 0; left < sets.length; left++) {
            for (let right = left + 1; right < sets.length; right++) {
                if (!isSubset(sets[left], sets[right]) && !isSubset(sets[right], sets[left])) {
                    return false;
                }
            }
        }
    }
    return true;
}

function parameterTypeAlternatives(value: string): Set<string> {
    const text = String(value || "")
        .replace(/\s+/g, " ")
        .replace(/\s*([<>,|&()[\]])\s*/g, "$1")
        .trim();
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if (char === "<" || char === "(" || char === "[") depth++;
        if ((char === ">" || char === ")" || char === "]") && depth > 0) depth--;
        if (char === "|" && depth === 0) {
            parts.push(text.slice(start, index));
            start = index + 1;
        }
    }
    parts.push(text.slice(start));
    return new Set(parts.map(part => part.trim()).filter(Boolean));
}

function isSubset(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
    for (const value of left) {
        if (!right.has(value)) return false;
    }
    return true;
}

function declarationFileFamily(file: string): "d.ets" | "d.ts" | undefined {
    const normalized = String(file || "").replace(/\\/g, "/");
    if (normalized.endsWith(".d.ets")) return "d.ets";
    if (normalized.endsWith(".d.ts")) return "d.ts";
    return undefined;
}

function normalizeIdentityPart(value: string | undefined): string {
    return String(value || "").trim();
}

function uniqueSorted(values: readonly string[]): string[] {
    return [...new Set(values.filter(value => String(value || "").length > 0))]
        .sort((left, right) => left.localeCompare(right));
}
