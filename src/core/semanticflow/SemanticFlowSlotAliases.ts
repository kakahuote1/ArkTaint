import type {
    SemanticFlowDecisionInput,
    SemanticFlowSurfaceSlotRef,
} from "./SemanticFlowTypes";

export interface SemanticFlowSlotAlias {
    name: string;
    ref: SemanticFlowSurfaceSlotRef;
}

export function collectSemanticFlowSlotAliases(input: SemanticFlowDecisionInput): SemanticFlowSlotAlias[] {
    const names = extractAnchorParameterNames(input);
    const out: SemanticFlowSlotAlias[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < names.length; index++) {
        const name = names[index];
        const key = canonicalSlotAliasKey(name);
        if (!key || seen.has(key)) {
            continue;
        }
        seen.add(key);
        out.push({
            name,
            ref: { slot: "arg", index },
        });
    }
    return out;
}

export function buildSemanticFlowSlotAliasLookup(input: SemanticFlowDecisionInput): Map<string, SemanticFlowSurfaceSlotRef> {
    const out = new Map<string, SemanticFlowSurfaceSlotRef>();
    for (const alias of collectSemanticFlowSlotAliases(input)) {
        out.set(canonicalSlotAliasKey(alias.name), cloneSlotRef(alias.ref));
    }
    return out;
}

export function canonicalSlotAliasKey(value: string): string {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, "-").replace(/_/g, "-");
}

export function formatSemanticFlowSlotAlias(alias: SemanticFlowSlotAlias): string {
    return `${alias.name} => ${formatSemanticFlowSlotRef(alias.ref)}`;
}

export function formatSemanticFlowSlotRef(ref: SemanticFlowSurfaceSlotRef): string {
    if (ref.slot === "arg" && typeof ref.index === "number") {
        return `arg${ref.index}`;
    }
    if (ref.slot === "result") {
        return "ret";
    }
    if (ref.slot === "base") {
        return "base";
    }
    if (ref.slot === "callback_param") {
        return `callback${ref.callbackArgIndex ?? 0}.param${ref.paramIndex ?? 0}`;
    }
    if (ref.slot === "method_param" && typeof ref.paramIndex === "number") {
        return `param${ref.paramIndex}`;
    }
    if (ref.slot === "field_load" && ref.fieldName) {
        return `field:${ref.fieldName}`;
    }
    if (ref.slot === "decorated_field_value") {
        return "decorated_field_value";
    }
    return ref.slot;
}

export function cloneSlotRef(ref: SemanticFlowSurfaceSlotRef): SemanticFlowSurfaceSlotRef {
    return {
        ...ref,
        fieldPath: Array.isArray(ref.fieldPath) ? [...ref.fieldPath] : ref.fieldPath,
    };
}

function extractAnchorParameterNames(input: SemanticFlowDecisionInput): string[] {
    const snippets = input.slice.snippets
        .filter(snippet => snippet.label === "method" || snippet.label === "method-body")
        .map(snippet => snippet.code);
    for (const code of snippets) {
        const params = extractParameterList(stripLinePrefixes(code), input.anchor.surface);
        if (params !== undefined) {
            return splitTopLevelComma(params)
                .map(parseParameterName)
                .filter((name): name is string => Boolean(name));
        }
    }
    return [];
}

function stripLinePrefixes(code: string): string {
    return String(code || "")
        .split(/\r?\n/)
        .map(line => line.replace(/^\s*\d+\s*\|\s?/, ""))
        .join("\n");
}

function extractParameterList(code: string, surface: string): string | undefined {
    const head = String(code || "").split(/\r?\n/).slice(0, 8).join("\n");
    const surfacePattern = new RegExp(`\\b${escapeRegExp(surface)}\\s*\\(`);
    const match = surfacePattern.exec(head);
    const openIndex = match ? match.index + match[0].lastIndexOf("(") : head.indexOf("(");
    if (openIndex < 0) {
        return undefined;
    }
    const closeIndex = findMatchingParen(head, openIndex);
    if (closeIndex <= openIndex) {
        return undefined;
    }
    return head.slice(openIndex + 1, closeIndex);
}

function findMatchingParen(text: string, openIndex: number): number {
    let depth = 0;
    let inString: string | undefined;
    for (let index = openIndex; index < text.length; index++) {
        const char = text[index];
        if (inString) {
            if (char === "\\") {
                index++;
                continue;
            }
            if (char === inString) {
                inString = undefined;
            }
            continue;
        }
        if (char === "'" || char === '"' || char === "`") {
            inString = char;
            continue;
        }
        if (char === "(") {
            depth++;
            continue;
        }
        if (char === ")") {
            depth--;
            if (depth === 0) {
                return index;
            }
        }
    }
    return -1;
}

function splitTopLevelComma(value: string): string[] {
    const out: string[] = [];
    let start = 0;
    let depth = 0;
    let inString: string | undefined;
    for (let index = 0; index < value.length; index++) {
        const char = value[index];
        if (inString) {
            if (char === "\\") {
                index++;
                continue;
            }
            if (char === inString) {
                inString = undefined;
            }
            continue;
        }
        if (char === "'" || char === '"' || char === "`") {
            inString = char;
            continue;
        }
        if (char === "(" || char === "[" || char === "{" || char === "<") {
            depth++;
            continue;
        }
        if ((char === ")" || char === "]" || char === "}" || char === ">") && depth > 0) {
            depth--;
            continue;
        }
        if (char === "," && depth === 0) {
            out.push(value.slice(start, index).trim());
            start = index + 1;
        }
    }
    out.push(value.slice(start).trim());
    return out.filter(Boolean);
}

function parseParameterName(raw: string): string | undefined {
    const withoutDefault = raw.split("=")[0].trim();
    const cleaned = withoutDefault
        .replace(/@\w+(?:\([^)]*\))?\s*/g, "")
        .replace(/\b(public|private|protected|readonly)\b/g, "")
        .replace(/^\.\.\./, "")
        .trim();
    const match = cleaned.match(/^([A-Za-z_$][\w$]*)\??(?:\s*:|$)/);
    if (!match) {
        return undefined;
    }
    const name = match[1];
    if (new Set(["this", "undefined", "null", "true", "false"]).has(name)) {
        return undefined;
    }
    return name;
}

function escapeRegExp(value: string): string {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
