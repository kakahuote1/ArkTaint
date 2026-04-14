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

const WRITE_OPS = ["push", "set", "add", "unshift", "splice", "delete", "clear"];
const READ_OPS = ["get", "has", "includes", "find", "slice", "at", "values", "keys", "entries"];
const READWRITE_OPS = ["pop", "shift"];

export function extractSharedCarrierContextFromFile(
    absPath: string,
    currentMethod: string,
): SharedCarrierContext | undefined {
    const lines = readSourceLines(absPath);
    if (!lines || !currentMethod.trim()) {
        return undefined;
    }
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
                        code: snippet,
                    });
                    index += Math.max(0, snippet.split(/\r?\n/).length - 1);
                    depth = 0;
                    continue;
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

function collectBalancedSnippet(lines: string[], startIndex: number): string | undefined {
    const out: string[] = [];
    let braceDepth = 0;
    let sawOpeningBrace = false;
    for (let index = startIndex; index < Math.min(lines.length, startIndex + 48); index++) {
        const line = lines[index];
        out.push(`${String(index + 1).padStart(5, " ")} | ${line}`);
        const opens = countChar(line, "{");
        const closes = countChar(line, "}");
        if (opens > 0) {
            sawOpeningBrace = true;
        }
        braceDepth += opens - closes;
        if (sawOpeningBrace && braceDepth <= 0) {
            return out.join("\n");
        }
    }
    return out.length > 0 ? out.join("\n") : undefined;
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
