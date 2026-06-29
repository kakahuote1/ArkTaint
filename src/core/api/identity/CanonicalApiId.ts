import type {
    ApiAuthority,
    ApiDomain,
    CanonicalApiDescriptor,
    CanonicalExportPath,
    CanonicalParameter,
    CanonicalType,
} from "./CanonicalApiDescriptor";

const CANONICAL_API_ID_PREFIX = "api";
const VALID_AUTHORITIES: readonly ApiAuthority[] = ["official", "project", "third_party"];
const VALID_DOMAINS: readonly ApiDomain[] = ["openharmony", "arkui", "arkts", "tsjs", "npm", "local"];
const VALID_INVOKE_KINDS = new Set(["call", "new", "property-read", "property-write", "decorator", "entry", "component-chain"]);
const VALID_MEMBER_KINDS = new Set(["function", "method", "constructor", "getter", "setter", "property", "decorator", "lifecycle", "component-event"]);

export interface CanonicalApiIdParts {
    authority: ApiAuthority;
    domain: ApiDomain;
    module: string;
    file: string;
    export: string;
    decl: string;
    member: string;
    invoke: string;
    params: string;
    ret: string;
}

export function buildCanonicalApiId(descriptor: Omit<CanonicalApiDescriptor, "canonicalApiId">): string {
    const id = serializeCanonicalApiId({
        authority: descriptor.authority,
        domain: descriptor.domain,
        module: descriptor.moduleSpecifier,
        file: descriptor.logicalDeclarationFile,
        export: serializeExportPath(descriptor.exportPath),
        decl: serializeDeclarationOwner(descriptor.declarationOwner.kind, descriptor.declarationOwner.path),
        member: serializeMember(descriptor.member.kind, descriptor.member.name, descriptor.member.static),
        invoke: descriptor.invoke.kind,
        params: serializeParameters(descriptor.signature.parameters),
        ret: descriptor.signature.returnType.text,
    });
    assertValidCanonicalApiId(id);
    return id;
}

export function serializeCanonicalApiId(parts: CanonicalApiIdParts): string {
    return [
        CANONICAL_API_ID_PREFIX,
        encodePart(parts.authority),
        encodePart(parts.domain),
        `module=${encodePart(parts.module)}`,
        `file=${encodePart(parts.file)}`,
        `export=${encodePart(parts.export)}`,
        `decl=${encodePart(parts.decl)}`,
        `member=${encodePart(parts.member)}`,
        `invoke=${encodePart(parts.invoke)}`,
        `params=${encodePart(parts.params)}`,
        `ret=${encodePart(parts.ret)}`,
    ].join(":");
}

export function parseCanonicalApiId(value: string): CanonicalApiIdParts | undefined {
    const segments = String(value || "").split(":");
    if (segments.length !== 11 || segments[0] !== CANONICAL_API_ID_PREFIX) return undefined;
    const authority = decodePart(segments[1]) as ApiAuthority;
    const domain = decodePart(segments[2]) as ApiDomain;
    const fields: Record<string, string> = {};
    for (const segment of segments.slice(3)) {
        const eq = segment.indexOf("=");
        if (eq <= 0) return undefined;
        const key = segment.slice(0, eq);
        const raw = segment.slice(eq + 1);
        if (fields[key] !== undefined) return undefined;
        fields[key] = decodePart(raw);
    }
    for (const key of ["module", "file", "export", "decl", "member", "invoke", "params", "ret"]) {
        if (fields[key] === undefined) return undefined;
    }
    return {
        authority,
        domain,
        module: fields.module,
        file: fields.file,
        export: fields.export,
        decl: fields.decl,
        member: fields.member,
        invoke: fields.invoke,
        params: fields.params,
        ret: fields.ret,
    };
}

export function assertValidCanonicalApiId(value: string): void {
    const parsed = parseCanonicalApiId(value);
    if (!parsed) {
        throw new Error(`invalid canonicalApiId: ${value}`);
    }
    if (!VALID_AUTHORITIES.includes(parsed.authority)) {
        throw new Error(`canonicalApiId has unsupported authority ${parsed.authority}: ${value}`);
    }
    if (!VALID_DOMAINS.includes(parsed.domain)) {
        throw new Error(`canonicalApiId has unsupported domain ${parsed.domain}: ${value}`);
    }
    const joined = Object.values(parsed).join(" ");
    if (joined.includes("%unk") || joined.includes("@%unk") || joined.includes("@unk")) {
        throw new Error(`canonicalApiId contains unknown identity evidence: ${value}`);
    }
    for (const [key, field] of Object.entries(parsed)) {
        if (typeof field !== "string" || field.trim().length === 0) {
            throw new Error(`canonicalApiId ${key} must be a non-empty field: ${value}`);
        }
        if (field === "undefined" || field === "null") {
            throw new Error(`canonicalApiId ${key} contains placeholder identity evidence: ${value}`);
        }
        if (key !== "params" && isUnknownIdentityText(field)) {
            throw new Error(`canonicalApiId ${key} contains unknown identity evidence: ${value}`);
        }
    }
    validateCanonicalApiParameterTypes(parsed.params, value);
    if (isPlaceholderTypeText(parsed.ret)) {
        throw new Error(`canonicalApiId return type must be exact: ${value}`);
    }
    if (parsed.module === "local") {
        throw new Error(`canonicalApiId module must not be the local placeholder: ${value}`);
    }
    if (parsed.file === "local" || parsed.file === "entry/local.d.ts" || parsed.file.endsWith("/local.d.ts")) {
        throw new Error(`canonicalApiId file must not be a local placeholder: ${value}`);
    }
    if (/^[A-Za-z]:[\\/]/.test(parsed.file) || parsed.file.startsWith("\\\\")) {
        throw new Error(`canonicalApiId file must be a logical declaration path: ${value}`);
    }
    validateCanonicalApiDecl(parsed.decl, parsed.member, value);
    validateCanonicalApiMember(parsed.member, value);
    if (!VALID_INVOKE_KINDS.has(parsed.invoke)) {
        throw new Error(`canonicalApiId has unsupported invoke kind ${parsed.invoke}: ${value}`);
    }
}

function validateCanonicalApiParameterTypes(params: string, fullId: string): void {
    if (params === "none") return;
    const entries = splitCanonicalParameterEntries(params);
    if (entries.length === 0) {
        throw new Error(`canonicalApiId params must be none or indexed parameter types: ${fullId}`);
    }
    entries.forEach((entry, expectedIndex) => {
        const colon = entry.indexOf(":");
        if (colon <= 0 || colon === entry.length - 1) {
            throw new Error(`canonicalApiId params must be indexed parameter types: ${fullId}`);
        }
        const index = Number(entry.slice(0, colon));
        if (!Number.isInteger(index) || index !== expectedIndex) {
            throw new Error(`canonicalApiId params must be dense and ordered: ${fullId}`);
        }
        const type = entry.slice(colon + 1).replace(/^\?:/, "").replace(/^rest:/, "").replace(/^\?rest:/, "");
        if (isPlaceholderTypeText(type)) {
            throw new Error(`canonicalApiId parameter type must be exact: ${fullId}`);
        }
    });
}

export function splitCanonicalParameterEntries(params: string): string[] {
    return String(params || "")
        .split(/,(?=\d+:)/)
        .map(entry => entry.trim())
        .filter(Boolean);
}

function isUnknownIdentityText(value: unknown): boolean {
    const text = String(value || "").trim().toLowerCase();
    if (!text) return true;
    if (text === "unknown" || text === "%unk" || text === "@unk" || text === "@%unk/%unk") return true;
    return text.includes("%unk") || text.includes("@unk");
}

function isPlaceholderTypeText(value: unknown): boolean {
    const text = String(value || "").trim().toLowerCase();
    if (!text) return true;
    if (text === "%unk" || text === "@unk" || text === "@%unk/%unk") return true;
    return text.includes("%unk") || text.includes("@unk");
}

function validateCanonicalApiDecl(decl: string, member: string, fullId: string): void {
    const colon = decl.indexOf(":");
    if (colon <= 0 || colon === decl.length - 1) {
        throw new Error(`canonicalApiId decl must include kind and owner path: ${fullId}`);
    }
    const kind = decl.slice(0, colon);
    const ownerPath = decl.slice(colon + 1).trim();
    const memberKind = member.split(":").filter(Boolean)[0] || "";
    if (!["namespace", "class", "interface", "type", "function", "file", "entry"].includes(kind)) {
        throw new Error(`canonicalApiId has unsupported declaration owner kind ${kind}: ${fullId}`);
    }
    if ((memberKind === "method" || memberKind === "constructor" || memberKind === "lifecycle")
        && (!ownerPath || ownerPath === "file")) {
        throw new Error(`canonicalApiId ${memberKind} must declare a precise non-file owner: ${fullId}`);
    }
}

function validateCanonicalApiMember(member: string, fullId: string): void {
    const parts = member.split(":").filter(Boolean);
    const kind = parts[0] || "";
    const name = parts[parts.length - 1] || "";
    if (!VALID_MEMBER_KINDS.has(kind)) {
        throw new Error(`canonicalApiId has unsupported member kind ${kind}: ${fullId}`);
    }
    if (!name || name === "unknown" || (name === "file" && kind !== "property")) {
        throw new Error(`canonicalApiId member must identify a precise declaration member: ${fullId}`);
    }
    if (kind === "method") {
        if (parts.length !== 3 || (parts[1] !== "static" && parts[1] !== "instance")) {
            throw new Error(`canonicalApiId method member must encode static or instance: ${fullId}`);
        }
    }
    if (kind === "constructor" && (parts.length !== 3 || parts[1] !== "new")) {
        throw new Error(`canonicalApiId constructor member must encode new: ${fullId}`);
    }
}

function serializeExportPath(path: CanonicalExportPath[]): string {
    return path.map(part => `${part.kind}:${part.name}`).join(".");
}

function serializeDeclarationOwner(kind: string, path: string[]): string {
    return `${kind}:${path.join(".") || "file"}`;
}

function serializeMember(kind: string, name: string, staticMember?: boolean): string {
    if (kind === "method") {
        return `${kind}:${staticMember ? "static" : "instance"}:${name}`;
    }
    if (kind === "constructor") {
        return `${kind}:new:${name}`;
    }
    return `${kind}:${name}`;
}

function serializeParameters(parameters: CanonicalParameter[]): string {
    if (parameters.length === 0) return "none";
    return parameters
        .slice()
        .sort((left, right) => left.index - right.index)
        .map(serializeParameter)
        .join(",");
}

function serializeParameter(parameter: CanonicalParameter): string {
    const flags = [
        parameter.optional ? "?" : "",
        parameter.rest ? "rest" : "",
    ].filter(Boolean).join("");
    const prefix = flags ? `${flags}:` : "";
    return `${parameter.index}:${prefix}${serializeType(parameter.type)}`;
}

function serializeType(type: CanonicalType): string {
    return normalizeTypeText(type.text);
}

function normalizeTypeText(value: unknown): string {
    return String(value || "unknown").replace(/\s+/g, " ").trim() || "unknown";
}

function encodePart(value: string): string {
    return encodeURIComponent(String(value));
}

function decodePart(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}
