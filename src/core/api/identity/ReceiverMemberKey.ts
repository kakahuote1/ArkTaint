import type { ImportMemberKey, KnownShapeConstraints } from "./ImportMemberKey";
import { isKnownIdentityTypeText, knownShapeConstraintsFromImportMemberKey } from "./ImportMemberKey";

export interface ReceiverMemberKey {
    moduleSpecifier: string;
    receiverType: string;
    memberName: string;
    invokeKind: "call" | "property-read" | "property-write";
    argShape: ImportMemberKey["argShape"];
    provenance: {
        sourceFile: string;
        enclosingMethodSignature: string;
        localName: string;
        producerOccurrenceId?: string;
        producerCanonicalApiId?: string;
        producerMemberName?: string;
    };
}

export interface ReceiverMemberCandidateKey {
    moduleSpecifier: string;
    receiverType: string;
    memberName: string;
    invokeKind: ReceiverMemberKey["invokeKind"];
    arity: number;
}

export interface ReceiverMemberSurfaceKey {
    moduleSpecifier: string;
    receiverType: string;
    memberName: string;
    invokeKind: ReceiverMemberKey["invokeKind"];
}

export function receiverMemberCandidateKeyString(key: ReceiverMemberCandidateKey): string {
    return JSON.stringify({
        moduleSpecifier: key.moduleSpecifier,
        receiverType: normalizeReceiverTypeName(key.receiverType),
        memberName: key.memberName,
        invokeKind: key.invokeKind,
        arity: key.arity,
    });
}

export function receiverMemberSurfaceKeyString(key: ReceiverMemberSurfaceKey): string {
    return JSON.stringify({
        moduleSpecifier: key.moduleSpecifier,
        receiverType: normalizeReceiverTypeName(key.receiverType),
        memberName: key.memberName,
        invokeKind: key.invokeKind,
    });
}

export function receiverMemberCandidateKeyFromReceiverMemberKey(key: ReceiverMemberKey): ReceiverMemberCandidateKey {
    return {
        moduleSpecifier: key.moduleSpecifier,
        receiverType: normalizeReceiverTypeName(key.receiverType),
        memberName: key.memberName,
        invokeKind: key.invokeKind,
        arity: key.argShape.arity,
    };
}

export function receiverMemberSurfaceKeyFromReceiverMemberKey(key: ReceiverMemberKey): ReceiverMemberSurfaceKey {
    return {
        moduleSpecifier: key.moduleSpecifier,
        receiverType: normalizeReceiverTypeName(key.receiverType),
        memberName: key.memberName,
        invokeKind: key.invokeKind,
    };
}

export function knownShapeConstraintsFromReceiverMemberKey(key: ReceiverMemberKey): KnownShapeConstraints {
    return knownShapeConstraintsFromImportMemberKey({
        moduleSpecifier: key.moduleSpecifier,
        importKind: "namespace",
        importedName: "*",
        localBindingId: key.provenance.localName,
        localName: key.provenance.localName,
        aliasChain: [],
        memberChain: [key.memberName],
        invokeKind: key.invokeKind,
        argShape: key.argShape,
        scopeEvidence: {
            sourceFile: key.provenance.sourceFile,
            enclosingMethodSignature: key.provenance.enclosingMethodSignature,
            shadowed: false,
        },
    });
}

export function receiverTypeCandidates(value: string): string[] {
    const out = new Set<string>();
    for (const normalized of receiverTypeCandidateRoots(value)) {
        if (!normalized || !isKnownIdentityTypeText(normalized)) continue;
        out.add(normalized);
        const last = normalized.split(".").filter(Boolean).pop();
        if (last) out.add(last);
    }
    return [...out].filter(Boolean);
}

export function normalizeReceiverTypeName(value: string): string {
    return receiverTypeCandidateRoots(value)[0] || "";
}

function receiverTypeCandidateRoots(value: string): string[] {
    const out = new Set<string>();
    for (const part of receiverTypeUnionParts(unwrapReceiverTypeText(value))) {
        const normalized = normalizeReceiverTypeRoot(part);
        if (!normalized || !isKnownIdentityTypeText(normalized) || isNonReceiverTypeText(normalized)) continue;
        out.add(normalized);
    }
    return [...out];
}

function unwrapReceiverTypeText(value: string): string {
    let text = normalizeReceiverTypeText(value);
    let changed = true;
    while (changed) {
        changed = false;
        const promise = /^Promise<(.+)>$/i.exec(text) || /^Awaited<(.+)>$/i.exec(text);
        if (promise) {
            text = normalizeReceiverTypeText(promise[1]);
            changed = true;
            continue;
        }
        const nullable = /^\?(.+)$/.exec(text);
        if (nullable) {
            text = normalizeReceiverTypeText(nullable[1]);
            changed = true;
        }
    }
    return text;
}

function normalizeReceiverTypeRoot(value: string): string {
    let text = normalizeReceiverTypeText(value);
    text = stripImportTypeWrapper(text);
    text = text.replace(/<[^<>]*>/g, "").trim();
    text = text.replace(/^\?/, "").trim();
    return text;
}

function stripImportTypeWrapper(value: string): string {
    return value.replace(/import\(["'][^"']+["']\)\./g, "");
}

function receiverTypeUnionParts(value: string): string[] {
    const text = normalizeReceiverTypeText(value);
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
    return parts.map(part => part.trim()).filter(Boolean);
}

function normalizeReceiverTypeText(value: string): string {
    return String(value || "")
        .replace(/\s+/g, " ")
        .replace(/\s*([<>,|&()[\]])\s*/g, "$1")
        .trim();
}

function isNonReceiverTypeText(value: string): boolean {
    const text = value.toLowerCase();
    return text === "void"
        || text === "undefined"
        || text === "null"
        || text === "never"
        || text === "string"
        || text === "number"
        || text === "boolean"
        || text === "bigint"
        || text === "symbol"
        || text === "any"
        || text === "unknown";
}
