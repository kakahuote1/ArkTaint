import * as fs from "fs";
import * as path from "path";
import { ARK_MAIN_FRAMEWORK_CALLBACK_METHOD_NAMES } from "../entry/arkmain/catalog/ArkMainFrameworkCatalog";
import {
    resolveAbilityLifecycleContract,
    resolveExtensionLifecycleContract,
    resolveStageLifecycleContract,
} from "../entry/arkmain/facts/ArkMainLifecycleContracts";
import type { NormalizedCallsiteItem } from "../model/callsite/callsiteContextSlices";

export interface ApiModelingCandidateScannerOptions {
    maxCandidates?: number;
}

interface ImportBinding {
    source: string;
    resolvedFile?: string;
}

interface CandidateAccumulator {
    item: NormalizedCallsiteItem;
    score: number;
}

interface MethodCandidate {
    owner?: string;
    method: string;
    isStatic: boolean;
    argCount: number;
    paramNames: string[];
    returnType?: string;
    startLine: number;
    code: string;
    score: number;
}

const OFFICIAL_ARKUI_COMPONENTS = new Set([
    "Button",
    "Checkbox",
    "Column",
    "ForEach",
    "Grid",
    "Image",
    "List",
    "ListItem",
    "Navigation",
    "Row",
    "Scroll",
    "Search",
    "Select",
    "Slider",
    "Stepper",
    "Swiper",
    "Tabs",
    "Text",
    "TextArea",
    "TextInput",
    "Toggle",
]);

const SKIP_DIRS = new Set([
    ".git",
    ".hvigor",
    ".ohos",
    "build",
    "node_modules",
    "oh_modules",
    "out",
    "output",
    "tmp",
]);

function normalizeSlashes(value: string): string {
    return String(value || "").replace(/\\/g, "/");
}

export function discoverApiCallbackModelingCandidates(
    repoRoot: string,
    sourceDirs: string[],
    options: ApiModelingCandidateScannerOptions = {},
): NormalizedCallsiteItem[] {
    const maxCandidates = Math.max(0, options.maxCandidates ?? 100);
    if (maxCandidates === 0) {
        return [];
    }
    const sourceFiles = collectSourceFiles(repoRoot, sourceDirs);
    const byKey = new Map<string, CandidateAccumulator>();
    for (const absFile of sourceFiles) {
        const relFile = normalizeSlashes(path.relative(repoRoot, absFile));
        const text = readText(absFile);
        if (!text) continue;
        const imports = collectImportBindings(repoRoot, absFile, text);
        for (const call of collectOptionCallbackCalls(text)) {
            if (OFFICIAL_ARKUI_COMPONENTS.has(call.callee)) continue;
            const callbackProperties = call.callbackProperties.filter(isModelingRelevantCallback);
            if (callbackProperties.length === 0) continue;
            const binding = imports.get(call.callee);
            const sourceFile = binding?.resolvedFile || relFile;
            const key = `${call.callee}|${sourceFile}|${callbackProperties.join(",")}`;
            const score = scoreCallbackCandidate(call.callee, callbackProperties, binding);
            const existing = byKey.get(key);
            const contextSlice = {
                callerFile: relFile,
                invokeLine: lineNumberAt(text, call.start),
                invokeStmtText: compactWhitespace(call.statementText).slice(0, 500),
                windowLines: formatLineWindow(text, lineNumberAt(text, call.start), 4),
                cfgNeighborStmts: [],
            };
            if (existing) {
                existing.item.count = (existing.item.count || 1) + 1;
                existing.score = Math.max(existing.score, score);
                const slices = Array.isArray((existing.item as any).contextSlices)
                    ? (existing.item as any).contextSlices as unknown[]
                    : [];
                if (slices.length < 3) {
                    (existing.item as any).contextSlices = [...slices, contextSlice];
                }
                continue;
            }
            byKey.set(key, {
                score,
                item: {
                    callee_signature: `@%unk/%unk: .${call.callee}()`,
                    method: call.callee,
                    invokeKind: "static",
                    argCount: 1,
                    sourceFile,
                    count: 1,
                    topEntries: [],
                    candidateOrigin: "recall_callback_surface",
                    callbackProperties,
                    importSource: binding?.source,
                    callerFiles: [relFile],
                    contextSlices: [contextSlice],
                } as NormalizedCallsiteItem,
            });
        }
        for (const call of collectMethodCallbackCalls(text)) {
            const sourceFile = relFile;
            const key = `${call.method}|${sourceFile}|${call.receiver}|${call.callbackArgIndexes.join(",")}`;
            const score = scoreMethodCallbackCandidate(call);
            const existing = byKey.get(key);
            const contextSlice = {
                callerFile: relFile,
                invokeLine: lineNumberAt(text, call.start),
                invokeStmtText: compactWhitespace(call.statementText).slice(0, 500),
                windowLines: formatLineWindow(text, lineNumberAt(text, call.start), 4),
                cfgNeighborStmts: [],
            };
            if (existing) {
                existing.item.count = (existing.item.count || 1) + 1;
                existing.score = Math.max(existing.score, score);
                const slices = Array.isArray((existing.item as any).contextSlices)
                    ? (existing.item as any).contextSlices as unknown[]
                    : [];
                if (slices.length < 3) {
                    (existing.item as any).contextSlices = [...slices, contextSlice];
                }
                continue;
            }
            byKey.set(key, {
                score,
                item: {
                    callee_signature: `@%unk/%unk: .${call.method}(${Array.from({ length: call.argCount }, () => "Unknown").join(", ")})`,
                    method: call.method,
                    invokeKind: "instance",
                    argCount: call.argCount,
                    sourceFile,
                    count: 1,
                    topEntries: [
                        `origin=recall_method_callback_surface`,
                        `receiver=${call.receiver}`,
                        `callbackArgIndexes=${call.callbackArgIndexes.join(",")}`,
                        ...(call.typeHint ? [`typeHint=${call.typeHint}`] : []),
                    ],
                    candidateOrigin: "recall_method_callback_surface",
                    callbackArgIndexes: call.callbackArgIndexes,
                    typeHint: call.typeHint,
                    callerFiles: [relFile],
                    contextSlices: [contextSlice],
                } as NormalizedCallsiteItem,
            });
        }
    }
    return [...byKey.values()]
        .sort((a, b) => b.score - a.score || (b.item.count || 0) - (a.item.count || 0)
            || String(a.item.method).localeCompare(String(b.item.method)))
        .slice(0, maxCandidates)
        .map(entry => entry.item);
}

function scoreMethodCallbackCandidate(call: MethodCallbackCall): number {
    let score = 40 + call.callbackArgIndexes.length * 8;
    const lowered = `${call.receiver}.${call.method}`.toLowerCase();
    if (lowered.includes("interceptors")) score += 45;
    if (lowered.includes("axios")) score += 18;
    if (/\b(response|request|error)\b/.test(lowered)) score += 10;
    if (/\b(event|socket|emitter|bus|channel)\b/.test(lowered)) score += 20;
    if (call.method === "use") score += 8;
    return score;
}

export function discoverApiSurfaceModelingCandidates(
    repoRoot: string,
    sourceDirs: string[],
    options: ApiModelingCandidateScannerOptions = {},
): NormalizedCallsiteItem[] {
    const maxCandidates = Math.max(0, options.maxCandidates ?? 100);
    if (maxCandidates === 0) {
        return [];
    }
    const sourceFiles = collectSourceFiles(repoRoot, sourceDirs);
    const out: CandidateAccumulator[] = [];
    for (const absFile of sourceFiles) {
        const relFile = normalizeSlashes(path.relative(repoRoot, absFile));
        const text = readText(absFile);
        if (!text || !isLikelyProjectApiWrapperFile(relFile, text)) {
            continue;
        }
        for (const method of collectProjectApiWrapperMethods(text)) {
            const score = scoreProjectApiWrapperMethod(relFile, method);
            if (score < 40) {
                continue;
            }
            const sourceFile = relFile;
            const baseItem = {
                callee_signature: buildProjectApiWrapperSignature(relFile, method),
                method: method.method,
                invokeKind: method.isStatic ? "static" : "instance",
                argCount: method.argCount,
                sourceFile,
                count: 1,
                topEntries: [
                    `origin=recall_api_surface`,
                    `score=${score}`,
                    ...candidateBoundaryHints(relFile, method),
                ],
                candidateOrigin: "recall_api_surface",
                methodSnippet: method.code,
                methodSnippetSource: "recall_api_surface",
                returnType: method.returnType,
                contextSlices: [{
                    callerFile: relFile,
                    callerMethod: method.owner ? `${method.owner}.${method.method}` : method.method,
                    invokeLine: method.startLine,
                    invokeStmtText: firstMeaningfulLine(method.code),
                    windowLines: method.code,
                    cfgNeighborStmts: [],
                }],
            } as NormalizedCallsiteItem;
            out.push({
                score,
                item: baseItem,
            });
            if (shouldCreateReturnedValueSurfaceCandidate(method)) {
                out.push({
                    score: score + 16,
                    item: {
                        ...baseItem,
                        topEntries: [
                            ...((baseItem.topEntries || []) as string[]),
                            "semanticFocus=returned_value_surface",
                        ],
                        candidateOrigin: "recall_returned_value_surface",
                        semanticFocus: "returned_value_surface",
                    } as NormalizedCallsiteItem,
                });
            }
        }
    }
    return selectApiSurfaceCandidateAccumulators(out, maxCandidates)
        .map(entry => entry.item);
}

function selectApiSurfaceCandidateAccumulators(
    candidates: CandidateAccumulator[],
    maxCandidates: number,
): CandidateAccumulator[] {
    const sorted = [...candidates]
        .sort((a, b) => b.score - a.score || String(a.item.callee_signature).localeCompare(String(b.item.callee_signature)));
    const byKey = new Map<string, CandidateAccumulator[]>();
    for (const candidate of sorted) {
        const key = apiSurfacePairKey(candidate.item);
        const group = byKey.get(key) || [];
        group.push(candidate);
        byKey.set(key, group);
    }
    const selected: CandidateAccumulator[] = [];
    const selectedKeys = new Set<string>();
    const add = (candidate: CandidateAccumulator): boolean => {
        if (selected.length >= maxCandidates) {
            return false;
        }
        const key = apiSurfaceCandidateKey(candidate.item);
        if (selectedKeys.has(key)) {
            return false;
        }
        selected.push(candidate);
        selectedKeys.add(key);
        return true;
    };
    for (const candidate of sorted) {
        if (selected.length >= maxCandidates) {
            break;
        }
        if (!add(candidate)) {
            continue;
        }
        const sibling = findApiSurfaceFocusSibling(candidate, byKey.get(apiSurfacePairKey(candidate.item)) || []);
        if (sibling) {
            add(sibling);
        }
    }
    return selected;
}

function findApiSurfaceFocusSibling(
    candidate: CandidateAccumulator,
    group: CandidateAccumulator[],
): CandidateAccumulator | undefined {
    const hasFocus = isReturnedValueCandidate(candidate.item);
    return group.find(item => isReturnedValueCandidate(item.item) !== hasFocus);
}

function isReturnedValueCandidate(item: NormalizedCallsiteItem): boolean {
    return String((item as any).semanticFocus || "").trim() === "returned_value_surface"
        || String((item as any).candidateOrigin || "").trim() === "recall_returned_value_surface";
}

function apiSurfacePairKey(item: NormalizedCallsiteItem): string {
    return [
        normalizeSlashes(String(item.sourceFile || "")),
        String((item as any).callee_signature || ""),
        String(item.method || ""),
        String((item as any).invokeKind || ""),
        String((item as any).argCount ?? ""),
    ].join("\u0000");
}

function apiSurfaceCandidateKey(item: NormalizedCallsiteItem): string {
    return [
        apiSurfacePairKey(item),
        String((item as any).candidateOrigin || ""),
        String((item as any).semanticFocus || ""),
    ].join("\u0000");
}

function collectSourceFiles(repoRoot: string, sourceDirs: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const sourceDir of sourceDirs.length > 0 ? sourceDirs : ["."]) {
        const abs = path.resolve(repoRoot, sourceDir);
        if (!fs.existsSync(abs)) continue;
        walkSourceFiles(abs, out, seen);
    }
    return out;
}

function isLikelyProjectApiWrapperFile(relFile: string, text: string): boolean {
    const normalized = normalizeSlashes(relFile).toLowerCase();
    if (/\/(pages?|components?|views?)\//.test(normalized)) {
        return false;
    }
    if (/(^|\/)(api|apis|service|services|network|net|request|requests|client|clients|repository|repositories|configure|database|db|cache|cacher|logger|log|tracks)(\/|$)/.test(normalized)) {
        return true;
    }
    if (hasBridgeModelingSignal(text)
        && /(^|\/)(bridge|bridges|jsbridge|webview|core)(\/|$)/.test(normalized)) {
        return true;
    }
    if (/(^|\/)(model|models|entity|entities|dto|dtos)(\/|$)/.test(normalized)
        && /\b(?:static\s+)?(?:from|patch|change|copy|clone)\s*\([^)]*\)\s*\{[\s\S]{0,1600}\b(?:return|=)\b/.test(text)) {
        return true;
    }
    const lowered = text.toLowerCase();
    return /\b(axios|http|request|fetch|post|get|put|delete|hilog|console|logger|fileio|writesync|relationalstore|rdb|preferences|appstorage)\b/.test(lowered)
        && /\b(export\s+(class|const|function)|class\s+[A-Z]|function\s+[A-Za-z_$])/.test(text);
}

function collectProjectApiWrapperMethods(text: string): MethodCandidate[] {
    const out: MethodCandidate[] = [];
    const lines = text.split(/\r?\n/);
    collectClassMethodCandidates(lines, out);
    collectTopLevelFunctionCandidates(lines, out);
    return out;
}

function collectClassMethodCandidates(lines: string[], out: MethodCandidate[]): void {
    const classPattern = /\b(?:export\s+)?(?:class|struct)\s+([A-Za-z_$][\w$]*)\b/;
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(classPattern);
        if (!m) continue;
        const owner = m[1];
        const end = findBlockEnd(lines, i);
        if (end < i) continue;
        let depth = 0;
        for (let j = i; j <= end; j++) {
            const line = lines[j];
            if (j > i && depth === 1) {
                const method = parseClassMethodHeader(line);
                if (method) {
                    const methodEnd = findBlockEnd(lines, j);
                    const snippet = collectSnippet(lines, j, methodEnd >= j ? methodEnd : end);
                    const paramNames = parseTopLevelParameterNames(method.params);
                    out.push({
                        owner,
                        method: method.name,
                        isStatic: method.isStatic,
                        argCount: paramNames.length,
                        paramNames,
                        returnType: method.returnType,
                        startLine: j + 1,
                        code: snippet,
                        score: 0,
                    });
                }
            }
            depth += countCharOutsideStrings(line, "{") - countCharOutsideStrings(line, "}");
        }
        i = end;
    }
}

function collectTopLevelFunctionCandidates(lines: string[], out: MethodCandidate[]): void {
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const fn = line.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(?:<[^>{}()]*>\s*)?\(([^)]*)\)/);
        const prop = line.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:<[^>{}()]*>\s*)?\(([^)]*)\)\s*(?::[^=]+)?=>/);
        const m = fn || prop;
        if (!m) continue;
        const snippet = collectSnippet(lines, i, Math.min(lines.length - 1, i + 80));
        const paramNames = parseTopLevelParameterNames(m[2]);
        out.push({
            method: m[1],
            isStatic: true,
            argCount: paramNames.length,
            paramNames,
            returnType: extractReturnTypeFromHeader(line),
            startLine: i + 1,
            code: snippet,
            score: 0,
        });
    }
}

function countTopLevelParameters(params: string): number {
    return parseTopLevelParameterNames(params).length;
}

function parseTopLevelParameterNames(params: string): string[] {
    const text = String(params || "").trim();
    if (!text) {
        return [];
    }
    let depth = 0;
    const parts: string[] = [];
    let current = "";
    for (const ch of text) {
        if (ch === "<" || ch === "(" || ch === "[" || ch === "{") {
            depth++;
        } else if ((ch === ">" || ch === ")" || ch === "]" || ch === "}") && depth > 0) {
            depth--;
        } else if (ch === "," && depth === 0) {
            parts.push(current);
            current = "";
            continue;
        }
        current += ch;
    }
    parts.push(current);
    return parts
        .map(part => part
            .replace(/^\s*(?:public|private|protected|readonly)\s+/, "")
            .replace(/\s*=.*$/s, "")
            .replace(/\s*:.*$/s, "")
            .replace(/^\s*\.\.\./, "")
            .replace(/\?$/, "")
            .trim())
        .filter(part => /^[A-Za-z_$][\w$]*$/.test(part));
}

function parseClassMethodHeader(line: string): { name: string; params: string; returnType?: string; isStatic: boolean } | undefined {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) return undefined;
    if (/^(if|for|while|switch|catch|return|else|new)\b/.test(trimmed)) return undefined;
    const m = trimmed.match(/^(?:(?:public|private|protected|override|readonly)\s+)*(static\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?:<[^>{}()]*>\s*)?\(([^)]*)\)/)
        || trimmed.match(/^(?:(?:public|private|protected|override|readonly)\s+)*(static\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:<[^>{}()]*>\s*)?\(([^)]*)\)\s*(?::[^=]+)?=>/);
    if (!m) return undefined;
    const name = m[2];
    if (name === "constructor" || /^[A-Z]/.test(name)) return undefined;
    return {
        name,
        params: m[3],
        returnType: extractReturnTypeFromHeader(line),
        isStatic: !!m[1],
    };
}

function extractReturnTypeFromHeader(line: string): string | undefined {
    const text = String(line || "");
    const parenIndex = text.lastIndexOf(")");
    if (parenIndex < 0) return undefined;
    const rest = text.slice(parenIndex + 1);
    const match = rest.match(/^\s*:\s*([^={;]+?)(?:\s*(?:=>|\{)|\s*$)/);
    const returnType = match?.[1]?.trim();
    return returnType || undefined;
}

function findBlockEnd(lines: string[], startIndex: number): number {
    let depth = 0;
    let sawOpeningBrace = false;
    for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i];
        const opens = countCharOutsideStrings(line, "{");
        const closes = countCharOutsideStrings(line, "}");
        if (opens > 0) sawOpeningBrace = true;
        depth += opens - closes;
        if (sawOpeningBrace && depth <= 0) return i;
    }
    return -1;
}

function collectSnippet(lines: string[], startIndex: number, maxEndIndex: number): string {
    const out: string[] = [];
    let depth = 0;
    let sawOpeningBrace = false;
    const endLimit = Math.min(lines.length - 1, startIndex + 70, maxEndIndex);
    for (let i = startIndex; i <= endLimit; i++) {
        const line = lines[i];
        out.push(`${String(i + 1).padStart(5, " ")} | ${line}`);
        const opens = countCharOutsideStrings(line, "{");
        const closes = countCharOutsideStrings(line, "}");
        if (opens > 0) sawOpeningBrace = true;
        depth += opens - closes;
        if (!sawOpeningBrace && /;\s*$/.test(line)) break;
        if (sawOpeningBrace && i > startIndex && depth <= 0) break;
    }
    return out.join("\n");
}

function countCharOutsideStrings(line: string, target: "{" | "}"): number {
    let count = 0;
    let quote: string | undefined;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quote) {
            if (ch === "\\") {
                i++;
                continue;
            }
            if (ch === quote) quote = undefined;
            continue;
        }
        if (ch === "\"" || ch === "'" || ch === "`") {
            quote = ch;
            continue;
        }
        if (ch === target) count++;
    }
    return count;
}

function scoreProjectApiWrapperMethod(relFile: string, candidate: MethodCandidate): number {
    const pathLower = normalizeSlashes(relFile).toLowerCase();
    const methodLower = candidate.method.toLowerCase();
    const bodyLower = candidate.code.toLowerCase();
    let score = 0;
    const hasBridgeSignal = hasBridgeModelingSignal(candidate.code) || hasBridgePathSignal(pathLower);
    const loggingPayload = isLoggingPayloadSurface(pathLower, methodLower, candidate);
    const loggingConfig = isLoggingConfigSurface(methodLower, bodyLower);
    const delegatedReturnedValue = hasDelegatedReturnedValueProducer(candidate);
    if (isOfficialArkMainEntryCandidate(pathLower, candidate.method, candidate.owner)) {
        score += 8;
    }
    if (isFrameworkContextHelperCandidate(pathLower, methodLower, bodyLower, candidate.owner)) {
        score -= 35;
    }
    const isModelMapper = isProjectModelMapperMethod(pathLower, methodLower, bodyLower, candidate);
    if (/(^|\/)(api|apis|service|services|network|net|request|requests|client|clients|repository|repositories|configure)(\/|$)/.test(pathLower)) score += 35;
    if (/(^|\/)(database|db|cache|cacher|logger|log|tracks)(\/|$)/.test(pathLower)) score += 24;
    if (isModelMapper) score += 48;
    if (/(request|post|get|put|delete|send|upload|download|login|credential|profile|token|cookie|session|cache|save|write|insert|update|execute|query|error|info|debug)/.test(methodLower)) score += 24;
    const hasExternalEffectSignal = /\b(axios|http|request|fetch|post|get|put|delete|websocket|socket|hilog|console|logger|fileio|writesync|relationalstore|rdb|rdbstore|executesql|transaction|database|sqlite|preferences|appstorage|persistent|localstorage)\b/.test(bodyLower)
        || hasBridgeSignal
        || loggingPayload
        || /\.\s*execute\s*\(/.test(bodyLower);
    if (hasBridgeSignal) score += 36;
    if (hasBridgeSignal && /^(call|calljs|callhandler|callbacktojs|returnvalue|registerjavascriptproxy|javascriptproxy|hasjavascriptmethod)/.test(methodLower)) score += 12;
    if (/\b(axios|http|request|fetch|post|get|put|delete|websocket|socket)\b/.test(bodyLower)) score += 36;
    if (delegatedReturnedValue) score += 24;
    if (/\b(hilog|console|logger)\b/.test(bodyLower)) score += 28;
    if (loggingPayload) score += 34;
    if (loggingPayload && candidate.owner && /^logger$/i.test(candidate.owner) && candidate.isStatic) score += 22;
    if (loggingConfig) score -= 42;
    if (/\b(fileio|writesync|write|copyfile|movefile)\b/.test(bodyLower)) score += 28;
    if (/\b(relationalstore|rdb|rdbstore|executesql|transaction|database|sqlite)\b/.test(bodyLower)
        || /\.\s*execute\s*\(/.test(bodyLower)) score += 28;
    if (/\b(preferences|appstorage|persistent|localstorage)\b/.test(bodyLower)) score += 18;
    if (/\b(access_token|refresh_token|authorizationcode|credential|password|phone|email|openid|unionid|token|cookie|apikey|session)\b/.test(bodyLower)) score += 18;
    if (/^(check|is|has|validate|format|parseurl|back|scroll|build|render)/.test(methodLower)) score -= 35;
    if (!hasExternalEffectSignal && !isModelMapper && !delegatedReturnedValue) score -= 30;
    if (/(\/context\.ets|\/stage\.ets|\/device\.ets)/.test(pathLower) || /(context|stage|window|avoidarea|safearea|windowsize)/.test(methodLower)) score -= 40;
    if (candidate.argCount === 0 && !/\b(return|await|axios|http|request|fetch|logger|hilog|console|read|getcredential)\b/.test(bodyLower)) score -= 20;
    return score;
}

function isLoggingPayloadSurface(pathLower: string, methodLower: string, candidate: MethodCandidate): boolean {
    if (!/(^|\/)(logger|log)(\/|$)/.test(pathLower)) {
        return false;
    }
    if (candidate.argCount <= 0) {
        return false;
    }
    return /^(log|reallog|logbycustomconfig|debug|info|warn|error|fatal|trace|verbose|json|json2|json3|d|i|w|e|f|dt|it|wt|et|ft)$/.test(methodLower);
}

function isLoggingConfigSurface(methodLower: string, bodyLower: string): boolean {
    if (/^(init|initialize|getlogger|addlogadapter|removelogadapter|clearlogadapter|setconfig|mergeconfig|config|isloggable)$/.test(methodLower)) {
        return true;
    }
    return /\b(addlogadapter|removelogadapter|clearlogadapter|printerproxys\.get|printerproxys\.set)\b/.test(bodyLower)
        && !/\b(hilog|console)\s*\./.test(bodyLower);
}

function candidateBoundaryHints(relFile: string, candidate: MethodCandidate): string[] {
    const pathLower = normalizeSlashes(relFile).toLowerCase();
    const methodLower = candidate.method.toLowerCase();
    const bodyLower = candidate.code.toLowerCase();
    const hints: string[] = [];
    if (isOfficialArkMainEntryCandidate(pathLower, candidate.method, candidate.owner)) {
        hints.push("candidateBoundary=official_arkmain_entry_evidence");
    }
    if (isFrameworkContextHelperCandidate(pathLower, methodLower, bodyLower, candidate.owner)) {
        hints.push("candidateBoundary=framework_context_helper_evidence");
    }
    if (/(^|\/)(api|apis|service|services|network|net|request|requests|client|clients|repository|repositories|database|db|cache|cacher|logger|log)(\/|$)/.test(pathLower)) {
        hints.push("candidateBoundary=project_or_third_party_wrapper_evidence");
    }
    if (hasBridgeModelingSignal(candidate.code) || hasBridgePathSignal(pathLower)) {
        hints.push("candidateBoundary=project_or_third_party_bridge_evidence");
    }
    return hints;
}

function hasBridgePathSignal(pathLower: string): boolean {
    return /(^|\/)(bridge|bridges|jsbridge|webview)(\/|$)/.test(pathLower);
}

function hasBridgeModelingSignal(text: string): boolean {
    return /\b(runJavaScript|registerJavaScriptProxy|javaScriptProxy|JavaScriptInterface|callHandler|callJs|Reflect\.get|WebviewController|webview)\b/.test(String(text || ""));
}

function isOfficialArkMainEntryCandidate(pathLower: string, methodName: string, owner?: string): boolean {
    return isFrameworkLifecycleCandidate(pathLower, methodName, owner)
        || isFrameworkCallbackCandidate(pathLower, methodName, owner);
}

function isFrameworkLifecycleCandidate(pathLower: string, methodName: string, owner?: string): boolean {
    if (!isFrameworkEntryOwnerOrPath(pathLower, owner)) {
        return false;
    }
    const ownerKind = classifyFrameworkEntryOwner(pathLower, owner);
    if (ownerKind === "stage") {
        return !!resolveStageLifecycleContract(methodName);
    }
    if (ownerKind === "extension") {
        return !!resolveExtensionLifecycleContract(methodName);
    }
    if (ownerKind === "ability") {
        return !!resolveAbilityLifecycleContract(methodName);
    }
    return !!resolveAbilityLifecycleContract(methodName)
        || !!resolveStageLifecycleContract(methodName)
        || !!resolveExtensionLifecycleContract(methodName);
}

function isFrameworkCallbackCandidate(pathLower: string, methodName: string, owner?: string): boolean {
    if (!isFrameworkEntryOwnerOrPath(pathLower, owner)) {
        return false;
    }
    return ARK_MAIN_FRAMEWORK_CALLBACK_METHOD_NAMES.has(methodName);
}

function isFrameworkContextHelperCandidate(pathLower: string, methodLower: string, bodyLower: string, owner?: string): boolean {
    if (!isFrameworkEntryOwnerOrPath(pathLower, owner)) {
        return false;
    }
    const contextHelperName = /(context|stage|window|avoidarea|safearea|windowsize|systembar|orientation|mainwindow)/.test(methodLower);
    const windowContextUse = /\b(windowstage|getmainwindow|getmainwindowsync|getwindowavoidarea|getwindowproperties|setsystembar|setwindowlayoutfullscreen|windowavoidarea|safearea)\b/.test(bodyLower);
    return contextHelperName && windowContextUse;
}

function isFrameworkEntryOwnerOrPath(pathLower: string, owner?: string): boolean {
    const ownerLower = String(owner || "").toLowerCase();
    return /(^|\/)(entryability|ability|abilities|extension|extensions|formability|formextension|serviceextension|serviceext|stub|idl|rpc|remote)(\/|$)/.test(pathLower)
        || /(ability|extension|formability|formextension|stub|remote|serviceext)$/.test(ownerLower)
        || /(entryability|formability|formextension|serviceextension|serviceext|stub|idl)/.test(ownerLower);
}

function classifyFrameworkEntryOwner(pathLower: string, owner?: string): "ability" | "stage" | "extension" | "unknown" {
    const ownerLower = String(owner || "").toLowerCase();
    if (/(^|\/)(abilitystage|stage)(\/|$)/.test(pathLower) || /(abilitystage|stage)$/.test(ownerLower)) {
        return "stage";
    }
    if (/(^|\/)(extension|extensions|formability|formextension|serviceextension|serviceext)(\/|$)/.test(pathLower)
        || /(extension|formability|formextension|serviceext)$/.test(ownerLower)
        || /(formextension|serviceextension|serviceext)/.test(ownerLower)) {
        return "extension";
    }
    if (/(^|\/)(entryability|ability|abilities)(\/|$)/.test(pathLower)
        || /(entryability|ability)$/.test(ownerLower)) {
        return "ability";
    }
    return "unknown";
}

function isProjectModelMapperMethod(
    pathLower: string,
    methodLower: string,
    bodyLower: string,
    candidate: MethodCandidate,
): boolean {
    if (!/(^|\/)(model|models|entity|entities|dto|dtos)(\/|$)/.test(pathLower)) {
        return false;
    }
    if (candidate.argCount <= 0) {
        return false;
    }
    if (!/^(from|patch|change|copy|clone|assign|merge)$/.test(methodLower)) {
        return false;
    }
    return /\b(?:json|dto|data|partial|payload|input|source)\b/.test(bodyLower)
        && /\b(?:return\s+instance|return\s+this|return\s+[a-z_$][\w$]*|new\s+[A-Z][\w$]*\s*\()/.test(bodyLower);
}

function shouldCreateReturnedValueSurfaceCandidate(candidate: MethodCandidate): boolean {
    const codeLower = candidate.code.toLowerCase();
    const methodLower = candidate.method.toLowerCase();
    if (/^(create|build|make|init|new)[a-z0-9_$]*/.test(methodLower)) {
        return false;
    }
    if (!/\breturn\b/.test(codeLower)) {
        return false;
    }
    if (hasVoidLikeReturnType(candidate.returnType)) {
        return false;
    }
    const hasReturnedValueProducer = hasExternalOrFrameworkResponseProducer(candidate.code)
        || hasDelegatedReturnedValueProducer(candidate);
    if (!hasReturnedValueProducer) {
        return false;
    }
    for (const param of candidate.paramNames) {
        const escaped = escapeRegExp(param.toLowerCase());
        if (new RegExp(`\\breturn\\s+(?:promise\\.resolve\\s*\\(\\s*)?${escaped}\\s*\\)?\\s*(?:;|$)`).test(codeLower)) {
            return false;
        }
    }
    if (/\b(?:response|res|ret|result)\.data\b/.test(codeLower)) {
        return true;
    }
    if (/\.then\s*\([^)]*=>[\s\S]{0,1200}\breturn\s+[A-Za-z_$][\w$]*/.test(candidate.code)) {
        return true;
    }
    if (/\breturn\s+(?:await\s+)?(?:axios|http|request|fetch|\$request|[A-Za-z_$][\w$]*\.(?:request|post|get|put|delete|fetch))\s*\(/.test(codeLower)) {
        return true;
    }
    if (/\bjson\s*\.\s*parse\s*\(/.test(codeLower) && returnsNonParameterValue(candidate)) {
        return true;
    }
    if (/\b(?:fromjson|from_json|parse|decode|convert|torestdto|tomodel)\s*\(/.test(codeLower) && returnsNonParameterValue(candidate)) {
        return true;
    }
    return /\breturn\s+(?:credential|profile|token|data|result|response|res|ret)\b/.test(codeLower)
        || returnsNonParameterValue(candidate);
}

function hasExternalOrFrameworkResponseProducer(code: string): boolean {
    const text = String(code || "");
    const lowered = text.toLowerCase();
    if (/\b(?:axios|http)\s*\(/.test(lowered)
        || /\b(?:axios|http)\s*\.\s*(?:request|post|get|put|delete|fetch)\s*\(/.test(lowered)
        || /\b(?:request|fetch|\$request)\s*\(/.test(lowered)
        || /\bwebsocket\b|\bsocket\b/.test(lowered)) {
        return true;
    }
    if (/\b(?:axios|http|fetch|request|client|api|apis|server|service|instance|\$request|this\.(?:http|client|api|apis|request|server|service)|this\._?(?:request|post|get|put|delete|fetch))\s*\.\s*(?:request|post|get|put|delete|fetch|postWithAuth|requestJson|fetchJson|sendRequest)\s*\(/i.test(text)) {
        return true;
    }
    return /\b(?:await|return)\s+(?:this\.)?(?:_?request|_?post|_?get|_?put|_?delete|postWithAuth|requestJson|fetchJson|sendRequest)\s*\(/i.test(text);
}

function hasVoidLikeReturnType(returnType?: string): boolean {
    const normalized = String(returnType || "")
        .replace(/\s+/g, "")
        .toLowerCase();
    return normalized === "void"
        || normalized === "undefined"
        || normalized === "promise<void>"
        || normalized === "promise<undefined>";
}

function hasDelegatedReturnedValueProducer(candidate: MethodCandidate): boolean {
    const code = String(candidate.code || "");
    if (!/\breturn\b/.test(code)) {
        return false;
    }
    const lowered = code.toLowerCase();
    return /\breturn\s+(?:await\s+)?(?:this\.)?[A-Za-z_$]*(?:dataSource|repository|repo|store|client|service|api|dao|orm|request|http|network)[A-Za-z_$]*\s*\.\s*[A-Za-z_$][\w$]*\s*\(/.test(code)
        || (/\b(?:prefs|preferences|orm|rdb|store|database|networkdatasource|datasource|repository)\b/.test(lowered)
            && returnsNonParameterValue(candidate));
}

function returnsNonParameterValue(candidate: MethodCandidate): boolean {
    const params = new Set(candidate.paramNames.map(name => name.toLowerCase()));
    const returnExprs = [...candidate.code.matchAll(/\breturn\s+([^;\n]+)/gi)]
        .map(match => match[1].replace(/\s+/g, " ").trim())
        .filter(Boolean);
    for (const expr of returnExprs) {
        const lowered = expr.toLowerCase();
        if (!lowered || /^(true|false|null|undefined|void\b|0|1|"[^"]*"|'[^']*')/.test(lowered)) {
            continue;
        }
        const bare = lowered.match(/^(?:await\s+)?([a-z_$][\w$]*)\s*(?:\)|$)/i)?.[1];
        if (bare && params.has(bare)) {
            continue;
        }
        if (/^promise\.resolve\s*\(\s*([a-z_$][\w$]*)\s*\)/i.test(lowered)) {
            const resolved = lowered.match(/^promise\.resolve\s*\(\s*([a-z_$][\w$]*)\s*\)/i)?.[1];
            if (resolved && params.has(resolved)) {
                continue;
            }
        }
        return true;
    }
    return false;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildProjectApiWrapperSignature(relFile: string, candidate: MethodCandidate): string {
    const args = Array.from({ length: Math.max(0, candidate.argCount) }, () => "Unknown").join(", ");
    const owner = candidate.owner
        ? `${candidate.owner}${candidate.isStatic ? ".[static]" : "."}${candidate.method}`
        : candidate.method;
    return `@${normalizeSlashes(relFile)}: ${owner}(${args})`;
}

function firstMeaningfulLine(code: string): string {
    const lines = String(code || "").split(/\r?\n/);
    for (const line of lines) {
        const stripped = line.replace(/^\s*\d+\s*\|\s*/, "").trim();
        if (stripped) return stripped.slice(0, 500);
    }
    return "";
}

function walkSourceFiles(absDir: string, out: string[], seen: Set<string>): void {
    const entries = safeReadDir(absDir);
    for (const entry of entries) {
        const abs = path.join(absDir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) {
                walkSourceFiles(abs, out, seen);
            }
            continue;
        }
        if (!entry.isFile() || !/\.(ets|ts)$/i.test(entry.name) || /\.d\.(ets|ts)$/i.test(entry.name)) continue;
        const resolved = path.resolve(abs);
        if (!seen.has(resolved)) {
            seen.add(resolved);
            out.push(resolved);
        }
    }
}

function safeReadDir(absDir: string): fs.Dirent[] {
    try {
        return fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
        return [];
    }
}

function readText(absFile: string): string | undefined {
    try {
        return fs.readFileSync(absFile, "utf-8");
    } catch {
        return undefined;
    }
}

function collectImportBindings(repoRoot: string, absFile: string, text: string): Map<string, ImportBinding> {
    const bindings = new Map<string, ImportBinding>();
    const namedImport = /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = namedImport.exec(text)) !== null) {
        const names = m[1].split(",")
            .map(part => part.trim().split(/\s+as\s+/i).pop() || "")
            .map(part => part.trim())
            .filter(Boolean);
        const source = m[2].trim();
        const resolvedFile = resolveRelativeImport(repoRoot, absFile, source);
        for (const name of names) {
            bindings.set(name, { source, resolvedFile });
        }
    }
    return bindings;
}

function resolveRelativeImport(repoRoot: string, absFile: string, source: string): string | undefined {
    if (!source.startsWith(".")) {
        return undefined;
    }
    const base = path.resolve(path.dirname(absFile), source);
    const candidates = [
        base,
        `${base}.ets`,
        `${base}.ts`,
        path.join(base, "index.ets"),
        path.join(base, "index.ts"),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return normalizeSlashes(path.relative(repoRoot, candidate));
        }
    }
    return undefined;
}

interface OptionCallbackCall {
    callee: string;
    start: number;
    statementText: string;
    callbackProperties: string[];
}

interface MethodCallbackCall {
    receiver: string;
    method: string;
    start: number;
    statementText: string;
    argCount: number;
    callbackArgIndexes: number[];
    typeHint?: string;
}

function collectOptionCallbackCalls(text: string): OptionCallbackCall[] {
    const out: OptionCallbackCall[] = [];
    const callRe = /\b([A-Z][A-Za-z0-9_$]*)\s*\(\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = callRe.exec(text)) !== null) {
        const callee = m[1];
        const openBrace = text.indexOf("{", m.index);
        if (openBrace < 0) continue;
        const closeBrace = findMatchingBrace(text, openBrace);
        if (closeBrace < 0) continue;
        const objectText = text.slice(openBrace, closeBrace + 1);
        const callbackProperties = extractCallbackProperties(objectText);
        if (callbackProperties.length === 0) continue;
        const statementEnd = findStatementEnd(text, closeBrace);
        out.push({
            callee,
            start: m.index,
            statementText: text.slice(m.index, statementEnd),
            callbackProperties,
        });
        callRe.lastIndex = Math.max(callRe.lastIndex, closeBrace + 1);
    }
    return out;
}

function collectMethodCallbackCalls(text: string): MethodCallbackCall[] {
    const out: MethodCallbackCall[] = [];
    const callRe = /\b([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*){1,5})\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = callRe.exec(text)) !== null) {
        const receiver = m[1].replace(/\s+/g, "");
        const method = m[2];
        if (!isModelingRelevantMethodCallback(receiver, method)) continue;

        const openParen = text.indexOf("(", m.index + m[0].lastIndexOf(method));
        if (openParen < 0) continue;
        const closeParen = findMatchingParen(text, openParen);
        if (closeParen < 0) continue;

        const argsText = text.slice(openParen + 1, closeParen);
        const args = splitTopLevelArguments(argsText);
        const callbackArgIndexes = args
            .map((arg, index) => isInlineCallbackArgument(arg) ? index : -1)
            .filter(index => index >= 0);
        if (callbackArgIndexes.length === 0) continue;

        const statementEnd = findStatementEnd(text, closeParen);
        out.push({
            receiver,
            method,
            start: m.index,
            statementText: text.slice(m.index, statementEnd),
            argCount: args.length,
            callbackArgIndexes,
            typeHint: inferMethodCallbackTypeHint(receiver, method),
        });
        callRe.lastIndex = Math.max(callRe.lastIndex, closeParen + 1);
    }
    return out;
}

function isModelingRelevantMethodCallback(receiver: string, method: string): boolean {
    const loweredReceiver = receiver.toLowerCase();
    const loweredMethod = method.toLowerCase();
    if (loweredMethod === "use" && loweredReceiver.includes("interceptors")) {
        return loweredReceiver.includes(".response");
    }
    if (/^(on|once|subscribe|addlistener|addeventlistener|register|listen)$/.test(loweredMethod)) {
        return /\b(event|emitter|bus|socket|websocket|channel|client|hub|manager|listener)\b/i.test(receiver);
    }
    return false;
}

function inferMethodCallbackTypeHint(receiver: string, method: string): string | undefined {
    const lowered = `${receiver}.${method}`.toLowerCase();
    if (lowered.includes("interceptors.response")) return "interceptors.response";
    if (lowered.includes("interceptors.request")) return "interceptors.request";
    if (lowered.includes("interceptors")) return "interceptors";
    if (lowered.includes("axios")) return "axios";
    if (lowered.includes("event")) return "event";
    if (lowered.includes("socket")) return "socket";
    return undefined;
}

function isInlineCallbackArgument(arg: string): boolean {
    const text = arg.trim();
    if (!text) return false;
    return /=>/.test(text) || /^\s*(?:async\s+)?function\b/.test(text);
}

function splitTopLevelArguments(argsText: string): string[] {
    const out: string[] = [];
    let current = "";
    let depth = 0;
    let quote: string | undefined;
    let lineComment = false;
    let blockComment = false;
    for (let i = 0; i < argsText.length; i++) {
        const ch = argsText[i];
        const next = argsText[i + 1];
        if (lineComment) {
            current += ch;
            if (ch === "\n") lineComment = false;
            continue;
        }
        if (blockComment) {
            current += ch;
            if (ch === "*" && next === "/") {
                current += next;
                i++;
                blockComment = false;
            }
            continue;
        }
        if (quote) {
            current += ch;
            if (ch === "\\") {
                current += next || "";
                i++;
                continue;
            }
            if (ch === quote) quote = undefined;
            continue;
        }
        if (ch === "/" && next === "/") {
            current += ch + next;
            i++;
            lineComment = true;
            continue;
        }
        if (ch === "/" && next === "*") {
            current += ch + next;
            i++;
            blockComment = true;
            continue;
        }
        if (ch === "\"" || ch === "'" || ch === "`") {
            quote = ch;
            current += ch;
            continue;
        }
        if (ch === "(" || ch === "[" || ch === "{") {
            depth++;
        } else if ((ch === ")" || ch === "]" || ch === "}") && depth > 0) {
            depth--;
        } else if (ch === "," && depth === 0) {
            out.push(current.trim());
            current = "";
            continue;
        }
        current += ch;
    }
    if (current.trim()) {
        out.push(current.trim());
    }
    return out;
}

function findMatchingParen(text: string, openIndex: number): number {
    let depth = 0;
    let quote: string | undefined;
    let lineComment = false;
    let blockComment = false;
    for (let i = openIndex; i < text.length; i++) {
        const ch = text[i];
        const next = text[i + 1];
        if (lineComment) {
            if (ch === "\n") lineComment = false;
            continue;
        }
        if (blockComment) {
            if (ch === "*" && next === "/") {
                blockComment = false;
                i++;
            }
            continue;
        }
        if (quote) {
            if (ch === "\\") {
                i++;
                continue;
            }
            if (ch === quote) quote = undefined;
            continue;
        }
        if (ch === "/" && next === "/") {
            lineComment = true;
            i++;
            continue;
        }
        if (ch === "/" && next === "*") {
            blockComment = true;
            i++;
            continue;
        }
        if (ch === "\"" || ch === "'" || ch === "`") {
            quote = ch;
            continue;
        }
        if (ch === "(") depth++;
        if (ch === ")") {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function findMatchingBrace(text: string, openIndex: number): number {
    let depth = 0;
    let quote: string | undefined;
    let lineComment = false;
    let blockComment = false;
    for (let i = openIndex; i < text.length; i++) {
        const ch = text[i];
        const next = text[i + 1];
        if (lineComment) {
            if (ch === "\n") lineComment = false;
            continue;
        }
        if (blockComment) {
            if (ch === "*" && next === "/") {
                blockComment = false;
                i++;
            }
            continue;
        }
        if (quote) {
            if (ch === "\\") {
                i++;
                continue;
            }
            if (ch === quote) quote = undefined;
            continue;
        }
        if (ch === "/" && next === "/") {
            lineComment = true;
            i++;
            continue;
        }
        if (ch === "/" && next === "*") {
            blockComment = true;
            i++;
            continue;
        }
        if (ch === "\"" || ch === "'" || ch === "`") {
            quote = ch;
            continue;
        }
        if (ch === "{") depth++;
        if (ch === "}") {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function findStatementEnd(text: string, fromIndex: number): number {
    const semi = text.indexOf(";", fromIndex);
    const newline = text.indexOf("\n", fromIndex);
    const candidates = [semi, newline].filter(v => v >= 0);
    return candidates.length > 0 ? Math.min(...candidates) + 1 : Math.min(text.length, fromIndex + 1);
}

function extractCallbackProperties(objectText: string): string[] {
    const out = new Set<string>();
    const arrow = /\b(on[A-Z][A-Za-z0-9_$]*)\s*:\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)(?:\s*:\s*[^=]+)?\s*=>/g;
    let m: RegExpExecArray | null;
    while ((m = arrow.exec(objectText)) !== null) {
        out.add(m[1]);
    }
    const reference = /\b(on[A-Z][A-Za-z0-9_$]*)\s*:\s*(?:this\.)?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?(?:\s*,|\s*\})/g;
    while ((m = reference.exec(objectText)) !== null) {
        out.add(m[1]);
    }
    return [...out].sort();
}

function isModelingRelevantCallback(name: string): boolean {
    return /^on[A-Z]/.test(name);
}

function scoreCallbackCandidate(callee: string, callbackProperties: string[], binding?: ImportBinding): number {
    let score = callbackProperties.length * 8;
    if (/(field|input|search|textarea|form)/i.test(callee)) score += 30;
    if (/(change|input|submit|search|phone|password|code|value|text)/i.test(callbackProperties.join(" "))) score += 35;
    if (/(click|tap|press|btn)/i.test(callbackProperties.join(" "))) score += 12;
    if (binding?.source && !binding.source.startsWith(".")) score += 8;
    if (binding?.resolvedFile) score += 6;
    return score;
}

function lineNumberAt(text: string, index: number): number {
    let line = 1;
    for (let i = 0; i < index && i < text.length; i++) {
        if (text[i] === "\n") line++;
    }
    return line;
}

function formatLineWindow(text: string, centerLine: number, radius: number): string {
    const lines = text.split(/\r?\n/);
    const start = Math.max(1, centerLine - radius);
    const end = Math.min(lines.length, centerLine + radius);
    const out: string[] = [];
    for (let line = start; line <= end; line++) {
        out.push(`${String(line).padStart(5, " ")} | ${lines[line - 1] ?? ""}`);
    }
    return out.join("\n");
}

function compactWhitespace(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}
