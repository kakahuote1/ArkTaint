import * as fs from "fs";

export interface SharedCarrierTouch {
    root: string;
    access: "read" | "write" | "readwrite";
    operations: string[];
}

export interface SharedCarrierMethodSnippet {
    method: string;
    code: string;
    sharedRoots: string[];
    carrierOps: string[];
}

export interface SharedCarrierContext {
    roots: string[];
    observations: string[];
    contextSnippet?: string;
    methodSnippets: SharedCarrierMethodSnippet[];
}

interface CarrierRootDeclaration {
    root: string;
    lineNumber: number;
    line: string;
}

interface FunctionSnippet {
    method: string;
    code: string;
}

interface BalancedSnippet {
    code: string;
    endIndex: number;
    complete: boolean;
}

const WRITE_OPS = ["push", "set", "add", "unshift", "splice", "delete", "clear"];
const READ_OPS = ["get", "has", "includes", "find", "slice", "at", "values", "keys", "entries"];
const READWRITE_OPS = ["pop", "shift"];

export function extractSharedCarrierContextFromFile(
    absPath: string,
    currentMethod: string,
    ownerClassName?: string,
): SharedCarrierContext | undefined {
    const lines = readSourceLines(absPath);
    if (!lines || !currentMethod.trim()) {
        return undefined;
    }
    const contexts: SharedCarrierContext[] = [];
    const topLevelContext = extractTopLevelSharedCarrierContext(lines, currentMethod);
    if (topLevelContext) {
        contexts.push(topLevelContext);
    }
    const receiverContext = ownerClassName
        ? extractReceiverFieldCarrierContext(lines, currentMethod, ownerClassName)
        : undefined;
    if (receiverContext) {
        contexts.push(receiverContext);
    }
    return mergeCarrierContexts(contexts);
}

function extractTopLevelSharedCarrierContext(
    lines: string[],
    currentMethod: string,
): SharedCarrierContext | undefined {
    const roots = extractTopLevelMutableRoots(lines);
    if (roots.length === 0) {
        return undefined;
    }
    const topLevelFunctions = extractTopLevelFunctionSnippets(lines);
    if (topLevelFunctions.length === 0) {
        return undefined;
    }
    const currentSnippet = topLevelFunctions.find(snippet => snippet.method === currentMethod.trim());
    if (!currentSnippet) {
        return undefined;
    }
    const currentTouches = collectCarrierTouches(currentSnippet.code, roots.map(root => root.root));
    if (currentTouches.length === 0) {
        return undefined;
    }
    const currentRoots = currentTouches.map(touch => touch.root);
    const companions: SharedCarrierMethodSnippet[] = [];
    for (const snippet of topLevelFunctions) {
        if (snippet.method === currentSnippet.method) {
            continue;
        }
        const touches = collectCarrierTouches(snippet.code, currentRoots);
        const sharedRoots = touches.map(touch => touch.root);
        if (sharedRoots.length === 0) {
            continue;
        }
        companions.push({
            method: snippet.method,
            code: compactCarrierFunctionSnippet(snippet.code, sharedRoots),
            sharedRoots,
            carrierOps: touches.flatMap(touch => touch.operations),
        });
    }
    const relevantRootDecls = roots.filter(root => currentRoots.includes(root.root));
    return {
        roots: currentRoots,
        observations: currentTouches.flatMap(touch => touch.operations.map(op => `carrierTouch=${touch.access}:${op}`)),
        contextSnippet: buildCarrierContextSnippet(relevantRootDecls, [currentSnippet.method, ...companions.map(item => item.method)]),
        methodSnippets: companions.slice(0, 3),
    };
}

function mergeCarrierContexts(contexts: SharedCarrierContext[]): SharedCarrierContext | undefined {
    const usable = contexts.filter(context => context.roots.length > 0);
    if (usable.length === 0) {
        return undefined;
    }
    const roots = uniqueStrings(usable.flatMap(context => context.roots));
    const observations = uniqueStrings(usable.flatMap(context => context.observations));
    const contextSnippets = usable
        .map(context => context.contextSnippet)
        .filter((snippet): snippet is string => Boolean(snippet && snippet.trim()));
    const methodSnippets = uniqueMethodSnippets(usable.flatMap(context => context.methodSnippets));
    return {
        roots,
        observations,
        contextSnippet: contextSnippets.length > 0 ? contextSnippets.join("\n\n") : undefined,
        methodSnippets: methodSnippets.slice(0, 5),
    };
}

function uniqueStrings(values: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of values) {
        const normalized = String(value || "").trim();
        if (!normalized || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        out.push(normalized);
    }
    return out;
}

function uniqueMethodSnippets(values: SharedCarrierMethodSnippet[]): SharedCarrierMethodSnippet[] {
    const seen = new Set<string>();
    const out: SharedCarrierMethodSnippet[] = [];
    for (const value of values) {
        const key = `${value.method}|${value.sharedRoots.join(",")}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        out.push(value);
    }
    return out;
}

function extractReceiverFieldCarrierContext(
    lines: string[],
    currentMethod: string,
    ownerClassName: string,
): SharedCarrierContext | undefined {
    const classBlock = findClassBlock(lines, ownerClassName);
    if (!classBlock) {
        return undefined;
    }
    const ownerMethods = extractClassMethodSnippets(lines, classBlock);
    if (ownerMethods.length === 0) {
        return undefined;
    }
    const current = ownerMethods.find(snippet => snippet.method === currentMethod.trim());
    if (!current) {
        return undefined;
    }
    const ownerMethodNames = new Set(ownerMethods.map(snippet => snippet.method));
    const currentTouches = collectReceiverFieldTouches(current.code, undefined, ownerMethodNames);
    if (currentTouches.length === 0) {
        return undefined;
    }

    const currentRoots = uniqueStrings(currentTouches.map(touch => touch.root));
    const carrierRootSet = new Set(currentRoots);
    const companions: SharedCarrierMethodSnippet[] = [];
    const companionMethods = new Set<string>();

    const addCompanion = (
        snippet: FunctionSnippet,
        touches: SharedCarrierTouch[],
        reason: string,
    ): void => {
        if (snippet.method === current.method || companionMethods.has(snippet.method) || touches.length === 0) {
            return;
        }
        const sharedRoots = uniqueStrings(touches.map(touch => touch.root));
        sharedRoots.forEach(root => carrierRootSet.add(root));
        companions.push({
            method: snippet.method,
            code: compactReceiverCarrierFunctionSnippet(snippet.code, sharedRoots),
            sharedRoots,
            carrierOps: uniqueStrings([
                reason,
                ...touches.flatMap(touch => touch.operations),
            ]),
        });
        companionMethods.add(snippet.method);
    };

    for (const snippet of ownerMethods) {
        if (snippet.method === current.method) {
            continue;
        }
        const touches = collectReceiverFieldTouches(snippet.code, currentRoots, ownerMethodNames);
        addCompanion(snippet, touches, "receiver-field-companion");
        const receiverCalls = extractReceiverMethodCalls(snippet.code)
            .filter(method => method !== current.method && ownerMethodNames.has(method));
        for (const calledMethod of receiverCalls) {
            const called = ownerMethods.find(item => item.method === calledMethod);
            if (!called) {
                continue;
            }
            const calledTouches = collectReceiverFieldTouches(called.code, undefined, ownerMethodNames);
            addCompanion(called, calledTouches, `receiver-field-callee:${snippet.method}`);
        }
    }

    if (companions.length === 0) {
        return undefined;
    }
    const roots = uniqueStrings([...currentRoots, ...companions.flatMap(companion => companion.sharedRoots)]);
    const relevantDecls = extractReceiverFieldDeclarationLines(lines, classBlock, roots);
    return {
        roots,
        observations: uniqueStrings([
            `receiverCarrierOwner=${ownerClassName}`,
            ...currentTouches.flatMap(touch => touch.operations.map(op => `carrierTouch=${touch.access}:${op}`)),
            ...companions.flatMap(companion => companion.carrierOps.map(op => `carrierCompanion=${companion.method}:${op}`)),
        ]),
        contextSnippet: buildReceiverCarrierContextSnippet(ownerClassName, roots, relevantDecls, [
            current.method,
            ...companions.map(item => item.method),
        ]),
        methodSnippets: companions.slice(0, 5),
    };
}

function findClassBlock(lines: string[], ownerClassName: string): { startIndex: number; endIndex: number } | undefined {
    const classPattern = new RegExp(`\\b(?:class|struct)\\s+${escapeRegExp(ownerClassName)}\\b`);
    for (let index = 0; index < lines.length; index++) {
        if (!classPattern.test(lines[index])) {
            continue;
        }
        let depth = 0;
        let sawOpeningBrace = false;
        for (let scan = index; scan < lines.length; scan++) {
            const line = lines[scan];
            const opens = countChar(line, "{");
            const closes = countChar(line, "}");
            if (opens > 0) {
                sawOpeningBrace = true;
            }
            depth += opens - closes;
            if (sawOpeningBrace && depth <= 0) {
                return { startIndex: index, endIndex: scan };
            }
        }
    }
    return undefined;
}

function extractClassMethodSnippets(
    lines: string[],
    classBlock: { startIndex: number; endIndex: number },
): FunctionSnippet[] {
    const snippets: FunctionSnippet[] = [];
    let depth = 0;
    for (let index = classBlock.startIndex; index <= classBlock.endIndex; index++) {
        const line = lines[index];
        if (index > classBlock.startIndex && depth === 1 && isClassMethodStartLine(line)) {
            const method = extractClassMethodName(line);
            if (method) {
                const snippet = collectBalancedSnippet(lines, index);
                if (snippet) {
                    snippets.push({ method, code: snippet.code });
                    if (snippet.complete) {
                        index = snippet.endIndex;
                        depth = 1;
                        continue;
                    }
                }
            }
        }
        depth += countChar(line, "{") - countChar(line, "}");
    }
    return snippets;
}

function isClassMethodStartLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) {
        return false;
    }
    if (/^(if|for|while|switch|catch|return|else|do|try|finally)\b/.test(trimmed)) {
        return false;
    }
    if (!/\(|=>/.test(trimmed)) {
        return false;
    }
    const modifiers = String.raw`(?:(?:public|private|protected|static|async|abstract|override|readonly)\s+)*`;
    return new RegExp(`^${modifiers}(?:constructor|[A-Za-z_$][\\w$]*)\\s*(?:<[^>]+>)?\\s*\\(`).test(trimmed)
        || new RegExp(`^${modifiers}(?:[A-Za-z_$][\\w$]*)\\s*=\\s*(?:async\\s*)?\\(`).test(trimmed);
}

function extractClassMethodName(line: string): string | undefined {
    const trimmed = line.trim();
    const modifiers = String.raw`(?:(?:public|private|protected|static|async|abstract|override|readonly)\s+)*`;
    const methodMatch = new RegExp(`^${modifiers}(constructor|[A-Za-z_$][\\w$]*)\\s*(?:<[^>]+>)?\\s*\\(`).exec(trimmed);
    if (methodMatch?.[1]) {
        return methodMatch[1];
    }
    const propertyMatch = new RegExp(`^${modifiers}([A-Za-z_$][\\w$]*)\\s*=\\s*(?:async\\s*)?\\(`).exec(trimmed);
    return propertyMatch?.[1];
}

function collectReceiverFieldTouches(
    code: string,
    allowedRoots?: string[],
    ownerMethodNames?: Set<string>,
): SharedCarrierTouch[] {
    const allowed = allowedRoots && allowedRoots.length > 0 ? new Set(allowedRoots) : undefined;
    const touchesByRoot = new Map<string, { read: boolean; write: boolean; operations: Set<string> }>();
    const text = String(code || "");
    const pattern = /\bthis\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g;
    for (const match of text.matchAll(pattern)) {
        const accessPath = String(match[1] || "").trim();
        if (!accessPath) {
            continue;
        }
        const parts = accessPath.split(".");
        const first = parts[0];
        const absoluteStart = match.index || 0;
        const absoluteEnd = absoluteStart + match[0].length;
        const after = text.slice(absoluteEnd, absoluteEnd + 8);
        if (parts.length === 1 && /^\s*\(/.test(after) && ownerMethodNames?.has(first)) {
            continue;
        }
        const root = `this.${first}`;
        const fullPath = `this.${accessPath}`;
        if (allowed && !allowed.has(root) && !allowed.has(fullPath)) {
            continue;
        }
        const entry = touchesByRoot.get(root) || { read: false, write: false, operations: new Set<string>() };
        const assignment = /^\s*=(?!=)/.test(after);
        const mutatingCall = isReceiverMutatingOperation(parts, after);
        if (assignment || mutatingCall) {
            entry.write = true;
            entry.operations.add(`${mutatingCall || fullPath}.write`);
        } else {
            entry.read = true;
            entry.operations.add(`${fullPath}.read`);
        }
        touchesByRoot.set(root, entry);
    }
    return [...touchesByRoot.entries()].map(([root, entry]) => ({
        root,
        access: entry.read && entry.write ? "readwrite" : entry.write ? "write" : "read",
        operations: [...entry.operations],
    }));
}

function isReceiverMutatingOperation(parts: string[], after: string): string | undefined {
    const method = parts[parts.length - 1];
    if (!WRITE_OPS.includes(method) && !READWRITE_OPS.includes(method)) {
        return undefined;
    }
    if (!/^\s*\(/.test(after)) {
        return undefined;
    }
    return `this.${parts.slice(0, -1).join(".")}.${method}`;
}

function extractReceiverMethodCalls(code: string): string[] {
    const out = new Set<string>();
    const pattern = /\bthis\.([A-Za-z_$][\w$]*)\s*\(/g;
    for (const match of String(code || "").matchAll(pattern)) {
        const method = String(match[1] || "").trim();
        if (method) {
            out.add(method);
        }
    }
    return [...out];
}

function extractReceiverFieldDeclarationLines(
    lines: string[],
    classBlock: { startIndex: number; endIndex: number },
    roots: string[],
): string[] {
    const fields = new Set(roots.map(root => root.replace(/^this\./, "").split(".")[0]).filter(Boolean));
    const out: string[] = [];
    let depth = 0;
    for (let index = classBlock.startIndex; index <= classBlock.endIndex; index++) {
        const line = lines[index];
        if (index > classBlock.startIndex && depth === 1) {
            for (const field of fields) {
                const pattern = new RegExp(`\\b${escapeRegExp(field)}\\b\\s*(?::|=|;)`);
                if (pattern.test(line) && !/\b(?:if|for|while|switch|return|catch)\b/.test(line.trim())) {
                    out.push(`${String(index + 1).padStart(5, " ")} | ${line}`);
                    break;
                }
            }
        }
        depth += countChar(line, "{") - countChar(line, "}");
    }
    return uniqueStrings(out).slice(0, 8);
}

function buildReceiverCarrierContextSnippet(
    ownerClassName: string,
    roots: string[],
    declarationLines: string[],
    methods: string[],
): string | undefined {
    if (roots.length === 0) {
        return undefined;
    }
    return [
        `receiverCarrierOwner: ${ownerClassName}`,
        "receiverCarrierRoots:",
        ...roots.map(root => `- ${root}`),
        ...(declarationLines.length > 0 ? ["", "receiverFieldDeclarations:", ...declarationLines] : []),
        "",
        "carrierMethods:",
        ...uniqueStrings(methods).map(method => `- ${method}`),
    ].join("\n");
}

function compactReceiverCarrierFunctionSnippet(code: string, sharedRoots: string[]): string {
    const lines = code.split(/\r?\n/).filter(Boolean);
    const keep = new Set<number>([0]);
    const rootFields = sharedRoots.map(root => root.replace(/^this\./, "").split(".")[0]).filter(Boolean);
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (/\breturn\b/.test(line)) {
            keep.add(index);
            continue;
        }
        if (sharedRoots.some(root => line.includes(root)) || rootFields.some(field => line.includes(`this.${field}`))) {
            keep.add(index);
            continue;
        }
        if (/\bthis\.[A-Za-z_$][\w$]*\s*\(/.test(line)) {
            keep.add(index);
        }
    }
    return [...keep]
        .sort((left, right) => left - right)
        .slice(0, 10)
        .map(index => lines[index])
        .join("\n");
}

function readSourceLines(absPath: string): string[] | undefined {
    try {
        if (!fs.existsSync(absPath)) {
            return undefined;
        }
        return fs.readFileSync(absPath, "utf8").split(/\r?\n/);
    } catch {
        return undefined;
    }
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTopLevelMutableRoots(lines: string[]): CarrierRootDeclaration[] {
    const roots: CarrierRootDeclaration[] = [];
    let depth = 0;
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (depth === 0) {
            const match = line.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)[^=]*=\s*(.+?)\s*;?\s*$/);
            const root = match?.[1]?.trim();
            const initializer = match?.[2] || "";
            if (root && isMutableInitializer(initializer)) {
                roots.push({
                    root,
                    lineNumber: index + 1,
                    line: `${String(index + 1).padStart(5, " ")} | ${line}`,
                });
            }
        }
        depth += countChar(line, "{") - countChar(line, "}");
    }
    return roots;
}

function extractTopLevelFunctionSnippets(lines: string[]): FunctionSnippet[] {
    const snippets: FunctionSnippet[] = [];
    let depth = 0;
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (depth === 0) {
            const method = extractTopLevelFunctionName(line);
            if (method) {
                const snippet = collectBalancedSnippet(lines, index);
                if (snippet) {
                    snippets.push({
                        method,
                        code: snippet.code,
                    });
                    if (snippet.complete) {
                        index = snippet.endIndex;
                        depth = 0;
                        continue;
                    }
                }
            }
        }
        depth += countChar(line, "{") - countChar(line, "}");
    }
    return snippets;
}

function extractTopLevelFunctionName(line: string): string | undefined {
    const match = line.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
    return match?.[1];
}

function collectBalancedSnippet(lines: string[], startIndex: number): BalancedSnippet | undefined {
    const out: string[] = [];
    let braceDepth = 0;
    let sawOpeningBrace = false;
    const displayEndExclusive = Math.min(lines.length, startIndex + 48);
    for (let index = startIndex; index < lines.length; index++) {
        const line = lines[index];
        if (index < displayEndExclusive) {
            out.push(`${String(index + 1).padStart(5, " ")} | ${line}`);
        }
        const opens = countChar(line, "{");
        const closes = countChar(line, "}");
        if (opens > 0) {
            sawOpeningBrace = true;
        }
        braceDepth += opens - closes;
        if (!sawOpeningBrace && /;\s*$/.test(line)) {
            return {
                code: out.join("\n"),
                endIndex: index,
                complete: true,
            };
        }
        if (sawOpeningBrace && braceDepth <= 0) {
            return {
                code: out.join("\n"),
                endIndex: index,
                complete: true,
            };
        }
    }
    return out.length > 0
        ? {
            code: out.join("\n"),
            endIndex: Math.min(lines.length - 1, displayEndExclusive - 1),
            complete: false,
        }
        : undefined;
}

function collectCarrierTouches(code: string, roots: string[]): SharedCarrierTouch[] {
    const touches: SharedCarrierTouch[] = [];
    for (const root of roots) {
        const operations = new Set<string>();
        let read = false;
        let write = false;
        for (const op of WRITE_OPS) {
            if (new RegExp(`\\b${escapeRegExp(root)}\\.${op}\\s*\\(`).test(code)) {
                write = true;
                operations.add(`${root}.${op}`);
            }
        }
        for (const op of READ_OPS) {
            if (new RegExp(`\\b${escapeRegExp(root)}\\.${op}\\s*\\(`).test(code)) {
                read = true;
                operations.add(`${root}.${op}`);
            }
        }
        for (const op of READWRITE_OPS) {
            if (new RegExp(`\\b${escapeRegExp(root)}\\.${op}\\s*\\(`).test(code)) {
                read = true;
                write = true;
                operations.add(`${root}.${op}`);
            }
        }
        if (new RegExp(`\\breturn\\s+${escapeRegExp(root)}(?:\\b|\\.|\\[)`).test(code)) {
            read = true;
            operations.add(`${root}.return`);
        }
        if (new RegExp(`\\b${escapeRegExp(root)}\\[[^\\]]+\\]\\s*=`).test(code) || new RegExp(`\\b${escapeRegExp(root)}\\.[A-Za-z_$][\\w$]*\\s*=`).test(code)) {
            write = true;
            operations.add(`${root}.assign`);
        }
        if (!read && !write) {
            continue;
        }
        touches.push({
            root,
            access: read && write ? "readwrite" : write ? "write" : "read",
            operations: [...operations],
        });
    }
    return touches;
}

function buildCarrierContextSnippet(
    roots: CarrierRootDeclaration[],
    methods: string[],
): string | undefined {
    if (roots.length === 0) {
        return undefined;
    }
    return [
        "sharedCarrierRoots:",
        ...roots.map(root => root.line),
        "",
        "carrierMethods:",
        ...methods.map(method => `- ${method}`),
    ].join("\n");
}

function compactCarrierFunctionSnippet(code: string, sharedRoots: string[]): string {
    const lines = code.split(/\r?\n/).filter(Boolean);
    const keep = new Set<number>([0]);
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (/\breturn\b/.test(line)) {
            keep.add(index);
        }
        if (sharedRoots.some(root => line.includes(`${root}.`) || line.includes(`${root}[`) || line.includes(`${root} `))) {
            keep.add(index);
        }
    }
    return [...keep]
        .sort((left, right) => left - right)
        .slice(0, 8)
        .map(index => lines[index])
        .join("\n");
}

function countChar(line: string, char: "{" | "}"): number {
    return (line.match(new RegExp(`\\${char}`, "g")) || []).length;
}

function isMutableInitializer(initializer: string): boolean {
    const normalized = initializer.trim();
    return normalized.startsWith("[")
        || normalized.startsWith("{")
        || /\bnew\s+(?:Map|Set|WeakMap|WeakSet|Array)\b/.test(normalized);
}
