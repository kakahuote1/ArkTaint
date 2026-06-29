import type {
    ApiAuthority,
    ApiDomain,
    CanonicalApiDescriptor,
    CanonicalExportPath,
    CanonicalInvokeKind,
    CanonicalMemberKind,
    CanonicalParameter,
    CanonicalType,
    ArkanalyzerMethodKey,
} from "./CanonicalApiDescriptor";
import {
    assertValidCanonicalApiId,
    parseCanonicalApiId,
    splitCanonicalParameterEntries,
} from "./CanonicalApiId";

export interface CanonicalApiDescriptorSeed {
    canonicalApiId: string;
    arkanalyzer?: ArkanalyzerMethodKey;
    declarationLocations?: Array<{ file: string; line?: number; column?: number }>;
}

export function canonicalApiDescriptorFromIdSeed(seed: CanonicalApiDescriptorSeed): CanonicalApiDescriptor {
    const canonicalApiId = String(seed.canonicalApiId || "").trim();
    assertValidCanonicalApiId(canonicalApiId);
    const parts = parseCanonicalApiId(canonicalApiId);
    if (!parts) {
        throw new Error(`invalid canonicalApiId: ${canonicalApiId}`);
    }
    const declarationOwner = parseDeclarationOwner(parts.decl);
    const member = parseMember(parts.member);
    const descriptor: CanonicalApiDescriptor = {
        canonicalApiId,
        authority: parts.authority as ApiAuthority,
        domain: parts.domain as ApiDomain,
        moduleSpecifier: parts.module,
        logicalDeclarationFile: parts.file,
        exportPath: parseExportPath(parts.export),
        declarationOwner,
        member,
        invoke: { kind: parts.invoke as CanonicalInvokeKind },
        signature: {
            parameters: parseParameters(parts.params),
            returnType: typeOf(parts.ret),
        },
        arkanalyzer: seed.arkanalyzer || deriveArkanalyzerMethodKey(parts.file, declarationOwner.normalizedName, member, parts.invoke as CanonicalInvokeKind, parts.params, parts.ret),
        provenance: {
            source: provenanceForAuthority(parts.authority as ApiAuthority),
            declarationLocations: seed.declarationLocations && seed.declarationLocations.length > 0
                ? seed.declarationLocations.map(item => ({ ...item }))
                : [{ file: parts.file }],
        },
    };
    return descriptor;
}

function parseExportPath(value: string): CanonicalExportPath[] {
    return String(value || "")
        .split(/\.(?=(default|namespace|named|component|entry|reexport):)/g)
        .filter(token => !/^(default|namespace|named|component|entry|reexport)$/.test(token))
        .map(token => {
            const colon = token.indexOf(":");
            if (colon <= 0 || colon === token.length - 1) {
                throw new Error(`invalid canonical export path segment: ${value}`);
            }
            return {
                kind: token.slice(0, colon) as CanonicalExportPath["kind"],
                name: token.slice(colon + 1),
            };
        });
}

function parseDeclarationOwner(value: string): CanonicalApiDescriptor["declarationOwner"] {
    const colon = value.indexOf(":");
    if (colon <= 0 || colon === value.length - 1) {
        throw new Error(`invalid canonical declaration owner: ${value}`);
    }
    const rawPath = value.slice(colon + 1);
    const path = rawPath.split(".").map(item => item.trim()).filter(Boolean);
    return {
        kind: value.slice(0, colon) as CanonicalApiDescriptor["declarationOwner"]["kind"],
        path,
        normalizedName: path.join(".") || rawPath,
    };
}

function parseMember(value: string): CanonicalApiDescriptor["member"] {
    const parts = String(value || "").split(":").filter(Boolean);
    const kind = parts[0] as CanonicalMemberKind;
    const name = parts[parts.length - 1] || "";
    return {
        kind,
        name,
        static: kind === "method" ? parts[1] === "static" : undefined,
    };
}

function parseParameters(value: string): CanonicalParameter[] {
    if (!value || value === "none") return [];
    return splitCanonicalParameterEntries(value).map((part, sequentialIndex) => {
        const chunks = part.split(":");
        let index = sequentialIndex;
        let rest = chunks;
        if (/^\d+$/.test(chunks[0] || "")) {
            index = Number(chunks[0]);
            rest = chunks.slice(1);
        }
        const optional = rest[0] === "?";
        const restParam = rest[0] === "rest" || rest[1] === "rest";
        const typeText = rest
            .filter(item => item !== "?" && item !== "rest")
            .join(":");
        return {
            index,
            optional,
            rest: restParam,
            type: typeOf(typeText),
        };
    });
}

function deriveArkanalyzerMethodKey(
    declaringFileName: string,
    declaringClassName: string,
    member: CanonicalApiDescriptor["member"],
    invokeKind: CanonicalInvokeKind,
    params: string,
    ret: string,
): ArkanalyzerMethodKey | undefined {
    if (invokeKind === "property-read" || invokeKind === "property-write" || invokeKind === "decorator" || invokeKind === "entry" || invokeKind === "component-chain") {
        return undefined;
    }
    if (member.kind !== "function" && member.kind !== "method" && member.kind !== "constructor" && member.kind !== "lifecycle") {
        return undefined;
    }
    return {
        declaringFileName,
        declaringNamespacePath: [],
        declaringClassName,
        methodName: member.kind === "constructor" ? "constructor" : member.name,
        parameterTypes: parseParameters(params).map(parameter => parameter.type.text),
        returnType: ret,
        staticFlag: member.static === true,
    };
}

function typeOf(text: string): CanonicalType {
    return {
        text: String(text || "").trim(),
    };
}

function provenanceForAuthority(authority: ApiAuthority): CanonicalApiDescriptor["provenance"]["source"] {
    if (authority === "project") return "project-declaration";
    if (authority === "third_party") return "third-party-declaration";
    return "official-declaration";
}
