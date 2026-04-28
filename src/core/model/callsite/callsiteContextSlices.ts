import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../../arkanalyzer/out/src/Config";
import { ArkInstanceInvokeExpr, ArkPtrInvokeExpr, ArkStaticInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { injectArkUiSdk } from "../../orchestration/ArkUiSdkConfig";
import {
    extractSharedCarrierContextFromFile,
    type SharedCarrierMethodSnippet,
} from "./callsiteCarrierFacts";

export interface NormalizedCallsiteItem {
    callee_signature: string;
    method: string;
    invokeKind: "instance" | "static" | "any";
    argCount: number;
    sourceFile: string;
    count?: number;
    topEntries?: string[];
    carrierRoots?: string[];
    carrierObservations?: string[];
    carrierSnippet?: string;
    carrierMethodSnippets?: SharedCarrierMethodSnippet[];
    [key: string]: unknown;
}

export interface CallsiteContextSlice {
    callerFile: string;
    callerMethod?: string;
    invokeLine: number;
    invokeStmtText: string;
    windowLines: string;
    cfgNeighborStmts?: string[];
}

interface OwnerMethodSnippet {
    method: string;
    code: string;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSlashes(p: string): string {
    return String(p || "").replace(/\\/g, "/").trim();
}

export function extractFilePathFromMethodSignature(signature: string): string {
    const m = signature.match(/@([^:>]+):/);
    return m ? normalizeSlashes(m[1]) : normalizeSlashes(signature);
}

export function extractFilePathFromInvokeSignature(signature: string): string {
    const m = signature.match(/<@([^:>]+\.(?:ets|ts)):/);
    if (m) return normalizeSlashes(m[1]);
    const m2 = signature.match(/@([^:>]+\.(?:ets|ts)):/);
    return m2 ? normalizeSlashes(m2[1]) : extractFilePathFromMethodSignature(signature);
}

export function normalizeNoCandidateItem(raw: any): NormalizedCallsiteItem {
    const callee_signature = String(raw?.callee_signature ?? raw?.calleeSignature ?? "").trim();
    const method = String(raw?.method ?? "").trim();
    const invokeKindRaw = String(raw?.invokeKind ?? "any").trim();
    const invokeKind: NormalizedCallsiteItem["invokeKind"] =
        invokeKindRaw === "static" ? "static" : invokeKindRaw === "instance" ? "instance" : "any";
    const argCount = Number(raw?.argCount);
    const sourceFile = normalizeSlashes(String(raw?.sourceFile ?? ""));
    return {
        ...raw,
        callee_signature,
        method,
        invokeKind,
        argCount: Number.isFinite(argCount) ? Math.floor(argCount) : 0,
        sourceFile,
        count: typeof raw?.count === "number" ? raw.count : undefined,
        topEntries: Array.isArray(raw?.topEntries) ? raw.topEntries.map((x: any) => String(x)) : undefined,
    };
}

function extractInvokeMethodName(invokeExpr: ArkInstanceInvokeExpr | ArkStaticInvokeExpr | ArkPtrInvokeExpr): string {
    const fromSig = invokeExpr.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
    if (fromSig) return String(fromSig);
    const raw = invokeExpr.getMethodSignature?.()?.toString?.() || "";
    const m = raw.match(/\.([A-Za-z0-9_$]+)\(/);
    return m ? m[1] : "";
}

function invokeKindOf(
    invokeExpr: ArkInstanceInvokeExpr | ArkStaticInvokeExpr | ArkPtrInvokeExpr,
): "instance" | "static" {
    return invokeExpr instanceof ArkStaticInvokeExpr ? "static" : "instance";
}

function pathsLooselyAlign(calleeFileFromSig: string, itemSourceFile: string): boolean {
    const cf = normalizeSlashes(calleeFileFromSig);
    const sf = normalizeSlashes(itemSourceFile);
    if (!sf || sf.includes("%unk")) return true;
    if (!cf || cf.includes("%unk")) return true;
    if (cf === sf) return true;
    if (cf.endsWith(sf) || sf.endsWith(cf)) return true;
    if (cf.includes(sf) || sf.includes(cf)) return true;
    return false;
}

function signaturesCompatible(itemSig: string, rawInvokeSig: string): boolean {
    const a = normalizeSlashes(itemSig).replace(/\s+/g, "");
    const b = normalizeSlashes(rawInvokeSig).replace(/\s+/g, "");
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.includes("@%unk/%unk") || b.includes("@%unk/%unk")) {
        const mItem = itemSig.match(/\.([A-Za-z0-9_$]+)\(/);
        const mRaw = rawInvokeSig.match(/\.([A-Za-z0-9_$]+)\(/);
        if (mItem && mRaw && mItem[1] === mRaw[1]) return true;
    }
    return false;
}

function itemMatchesInvoke(item: NormalizedCallsiteItem, invokeExpr: ArkInstanceInvokeExpr | ArkStaticInvokeExpr | ArkPtrInvokeExpr): boolean {
    const methodName = extractInvokeMethodName(invokeExpr);
    if (methodName !== item.method) return false;
    const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    if (args.length !== item.argCount) return false;
    const ik = invokeKindOf(invokeExpr);
    if (item.invokeKind !== "any" && item.invokeKind !== ik) return false;
    const rawSig = invokeExpr.getMethodSignature?.()?.toString?.() || "";
    const calleeFp = extractFilePathFromInvokeSignature(rawSig);
    if (!pathsLooselyAlign(calleeFp, item.sourceFile)) return false;
    return signaturesCompatible(item.callee_signature, rawSig);
}

function formatLineWindow(lines: string[], center1Based: number, radius: number): string {
    if (lines.length === 0) return "";
    const start = Math.max(1, center1Based - radius);
    const end = Math.min(lines.length, center1Based + radius);
    const parts: string[] = [];
    for (let i = start; i <= end; i++) {
        const text = lines[i - 1] ?? "";
        parts.push(`${String(i).padStart(5, " ")} | ${text}`);
    }
    return parts.join("\n");
}

function readSourceLines(absPath: string): string[] | undefined {
    try {
        if (!fs.existsSync(absPath)) return undefined;
        const raw = fs.readFileSync(absPath, "utf-8");
        return raw.split(/\r?\n/);
    } catch {
        return undefined;
    }
}

function resolveCallerFile(repoRoot: string, callerFilePath: string): string | undefined {
    const normalized = normalizeSlashes(callerFilePath);
    const c1 = path.resolve(repoRoot, normalized);
    if (fs.existsSync(c1)) return c1;
    const base = path.basename(normalized);
    if (base && fs.existsSync(path.resolve(repoRoot, base))) {
        return path.resolve(repoRoot, base);
    }
    return undefined;
}

function resolveProjectSourceFile(repoRoot: string, sourceDirs: string[], relativeFilePath: string): string | undefined {
    const normalized = normalizeSlashes(relativeFilePath);
    if (!normalized || normalized.includes("%unk")) {
        return undefined;
    }
    const direct = path.resolve(repoRoot, normalized);
    if (fs.existsSync(direct)) {
        return direct;
    }
    for (const sourceDir of sourceDirs) {
        const absSourceDir = path.resolve(repoRoot, sourceDir);
        const candidates = [
            path.resolve(absSourceDir, normalized),
            path.resolve(path.dirname(absSourceDir), normalized),
            path.resolve(path.dirname(path.dirname(absSourceDir)), normalized),
        ];
        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
    }
    return undefined;
}

function extractOwnerClassNameFromMethodSignature(signature: string): string | undefined {
    const normalized = String(signature || "").trim();
    if (!normalized) {
        return undefined;
    }
    const openParen = normalized.indexOf("(");
    const methodDot = normalized.lastIndexOf(".", openParen >= 0 ? openParen : normalized.length);
    const ownerText = methodDot >= 0 ? normalized.slice(0, methodDot) : normalized;
    const colon = ownerText.lastIndexOf(":");
    const owner = colon >= 0 ? ownerText.slice(colon + 1) : ownerText;
    const trimmed = owner.trim();
    return trimmed || undefined;
}

function extractMethodSnippetFromFile(absPath: string, methodName: string): string | undefined {
    const lines = readSourceLines(absPath);
    const normalizedMethod = String(methodName || "").trim();
    if (!lines || !normalizedMethod) {
        return undefined;
    }
    const methodPattern = new RegExp(
        `^\\s*(?:public\\s+|private\\s+|protected\\s+)?(?:static\\s+)?(?:async\\s+)?${escapeRegExp(normalizedMethod)}\\s*\\(`,
    );
    const functionPattern = new RegExp(
        `^\\s*(?:export\\s+)?(?:async\\s+)?function\\s+${escapeRegExp(normalizedMethod)}\\s*\\(`,
    );
    const propertyPattern = new RegExp(
        `^\\s*(?:public\\s+|private\\s+|protected\\s+)?(?:static\\s+)?(?:readonly\\s+)?${escapeRegExp(normalizedMethod)}\\s*=\\s*(?:async\\s*)?\\(`,
    );
    let startIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (methodPattern.test(line) || functionPattern.test(line) || propertyPattern.test(line)) {
            startIndex = i;
            break;
        }
    }
    if (startIndex < 0) {
        return undefined;
    }

    let braceDepth = 0;
    let sawOpeningBrace = false;
    const out: string[] = [];
    const maxLines = 40;
    for (let i = startIndex; i < Math.min(lines.length, startIndex + maxLines); i++) {
        const line = lines[i];
        out.push(`${String(i + 1).padStart(5, " ")} | ${line}`);
        const opens = (line.match(/\{/g) || []).length;
        const closes = (line.match(/\}/g) || []).length;
        if (opens > 0) {
            sawOpeningBrace = true;
        }
        braceDepth += opens - closes;
        if (sawOpeningBrace && braceDepth <= 0) {
            break;
        }
    }
    return out.join("\n");
}

function findClassBlock(lines: string[], ownerClassName: string): { startIndex: number; endIndex: number } | undefined {
    const classPattern = new RegExp(`\\b(?:class|struct)\\s+${escapeRegExp(ownerClassName)}\\b`);
    for (let i = 0; i < lines.length; i++) {
        if (!classPattern.test(lines[i])) {
            continue;
        }
        let braceDepth = 0;
        let sawOpeningBrace = false;
        for (let j = i; j < lines.length; j++) {
            const line = lines[j];
            const opens = (line.match(/\{/g) || []).length;
            const closes = (line.match(/\}/g) || []).length;
            if (opens > 0) {
                sawOpeningBrace = true;
            }
            braceDepth += opens - closes;
            if (sawOpeningBrace && braceDepth <= 0) {
                return { startIndex: i, endIndex: j };
            }
        }
    }
    return undefined;
}

function isTopLevelMethodLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) {
        return false;
    }
    if (/^(if|for|while|switch|catch|return|else)\b/.test(trimmed)) {
        return false;
    }
    if (!/\(/.test(trimmed)) {
        return false;
    }
    return /\b(?:public|private|protected)?\s*(?:static\s+)?(?:async\s+)?[A-Za-z_$][\w$]*\s*\(/.test(trimmed)
        || /\b(?:public|private|protected)?\s*(?:static\s+)?(?:readonly\s+)?[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?\(/.test(trimmed);
}

function extractMethodNameFromDefinition(line: string): string | undefined {
    const trimmed = line.trim();
    const match = trimmed.match(/^(?:public|private|protected)?\s*(?:static\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/)
        || trimmed.match(/^(?:public|private|protected)?\s*(?:static\s+)?(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/);
    return match?.[1];
}

function extractOwnerMethodSnippetsFromFile(absPath: string, ownerClassName: string): OwnerMethodSnippet[] {
    const lines = readSourceLines(absPath);
    if (!lines || !ownerClassName) {
        return [];
    }
    const classBlock = findClassBlock(lines, ownerClassName);
    if (!classBlock) {
        return [];
    }

    const snippets: OwnerMethodSnippet[] = [];
    let depth = 0;
    for (let i = classBlock.startIndex; i <= classBlock.endIndex; i++) {
        const line = lines[i];
        if (i > classBlock.startIndex && depth === 1 && isTopLevelMethodLine(line)) {
            const method = extractMethodNameFromDefinition(line);
            if (!method) {
                // continue scanning depth accounting below
            } else {
                const startIndex = i;
                let localDepth = 0;
                let sawOpeningBrace = false;
                const out: string[] = [];
                const maxLines = 48;
                for (let j = i; j <= Math.min(classBlock.endIndex, i + maxLines - 1); j++) {
                    const current = lines[j];
                    out.push(`${String(j + 1).padStart(5, " ")} | ${current}`);
                    const opens = (current.match(/\{/g) || []).length;
                    const closes = (current.match(/\}/g) || []).length;
                    if (opens > 0) {
                        sawOpeningBrace = true;
                    }
                    localDepth += opens - closes;
                    if (j > startIndex && sawOpeningBrace && localDepth <= 0) {
                        i = j - 1;
                        break;
                    }
                    if (j === Math.min(classBlock.endIndex, i + maxLines - 1)) {
                        i = j;
                    }
                }
                snippets.push({
                    method,
                    code: out.join("\n"),
                });
            }
        }
        const opens = (line.match(/\{/g) || []).length;
        const closes = (line.match(/\}/g) || []).length;
        depth += opens - closes;
    }
    return snippets;
}

function extractMethodHeaderLine(code: string): string | undefined {
    const first = String(code || "").split(/\r?\n/).find(line => line.trim().length > 0);
    return first?.trim() || undefined;
}

function collectEvidenceTokens(texts: string[]): string[] {
    const tokens = new Set<string>();
    for (const text of texts) {
        for (const match of String(text || "").matchAll(/\b[A-Za-z_$][\w$]*\b/g)) {
            const token = String(match[0] || "").trim();
            if (!token || token.length < 3) {
                continue;
            }
            tokens.add(token);
        }
    }
    return [...tokens];
}

function selectRelevantImportLines(lines: string[], evidenceTexts: string[]): string[] {
    const imports = lines
        .map((line, index) => ({ line, index }))
        .filter(entry => /^\s*import\s+/.test(entry.line));
    if (imports.length === 0) {
        return [];
    }
    const tokens = collectEvidenceTokens(evidenceTexts);
    const scored = imports.map(entry => {
        const text = entry.line;
        let score = 0;
        for (const token of tokens) {
            if (text.includes(token)) {
                score += 1;
            }
        }
        return { ...entry, score };
    });
    const picked = scored.some(entry => entry.score > 0)
        ? scored.filter(entry => entry.score > 0).sort((left, right) => right.score - left.score || left.index - right.index)
        : scored;
    return picked.slice(0, 4).map(entry => `${String(entry.index + 1).padStart(5, " ")} | ${entry.line}`);
}

function buildCompactOwnerSnippet(
    absPath: string,
    ownerMethods: OwnerMethodSnippet[],
    focusMethods: string[],
    evidenceTexts: string[],
): string | undefined {
    const lines = readSourceLines(absPath);
    if (!lines || lines.length === 0) {
        return undefined;
    }
    const focusSet = new Set(focusMethods.map(method => String(method || "").trim()).filter(Boolean));
    const importLines = selectRelevantImportLines(lines, evidenceTexts);
    const headerLines = ownerMethods
        .filter(entry => focusSet.has(entry.method))
        .map(entry => extractMethodHeaderLine(entry.code))
        .filter((line): line is string => Boolean(line))
        .slice(0, 5);
    const out: string[] = [];
    if (importLines.length > 0) {
        out.push("imports:");
        out.push(...importLines);
    }
    if (headerLines.length > 0) {
        if (out.length > 0) {
            out.push("");
        }
        out.push("ownerMethods:");
        out.push(...headerLines);
    }
    return out.length > 0 ? out.join("\n") : undefined;
}

function extractDelegateReceivers(code: string): string[] {
    const out = new Set<string>();
    const pattern = /\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\(/g;
    for (const match of String(code || "").matchAll(pattern)) {
        const receiver = String(match[1] || "").trim();
        if (!receiver || receiver === "this" || receiver === "super") {
            continue;
        }
        out.add(receiver);
    }
    return [...out];
}

function scoreOwnerMethodSnippet(
    currentMethod: string,
    currentCode: string,
    candidate: OwnerMethodSnippet,
): number {
    if (candidate.method === currentMethod) {
        return -1;
    }
    let score = 0;
    const currentReceivers = extractDelegateReceivers(currentCode);
    const candidateReceivers = extractDelegateReceivers(candidate.code);
    for (const receiver of candidateReceivers) {
        if (currentReceivers.includes(receiver)) {
            score += 5;
        }
    }
    const wrapperTokens = ["push", "replace", "back", "get", "set", "post", "emit", "bind", "subscribe", "publish"];
    if (wrapperTokens.some(token => candidate.method.toLowerCase().includes(token))) {
        score += 1;
    }
    if (/return\s+[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*\s*\(/.test(candidate.code)) {
        score += 2;
    }
    if (candidate.code.includes(".then(") || candidate.code.includes(".catch(") || candidate.code.includes(".finally(")) {
        score += 1;
    }
    return score;
}

function selectOwnerFamilySnippets(
    ownerMethods: OwnerMethodSnippet[],
    currentMethod: string,
    currentCode: string,
    limit: number,
): OwnerMethodSnippet[] {
    return [...ownerMethods]
        .filter(item => item.method !== currentMethod)
        .map(item => ({
            item,
            score: scoreOwnerMethodSnippet(currentMethod, currentCode, item),
        }))
        .filter(entry => entry.score > 0)
        .sort((left, right) => right.score - left.score || left.item.method.localeCompare(right.item.method))
        .slice(0, limit)
        .map(entry => entry.item);
}

function compactOwnerMethodSnippet(
    currentCode: string,
    snippet: OwnerMethodSnippet,
): OwnerMethodSnippet {
    const lines = String(snippet.code || "").split(/\r?\n/).filter(Boolean);
    const currentReceivers = extractDelegateReceivers(currentCode);
    const keep = new Set<number>([0]);
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (/\breturn\b/.test(line)) {
            keep.add(index);
            continue;
        }
        if (/=>|\.then\(|\.catch\(|\.finally\(/.test(line)) {
            continue;
        }
        if (currentReceivers.some(receiver => line.includes(`${receiver}.`))) {
            keep.add(index);
            continue;
        }
    }
    if (keep.size <= 1) {
        for (let index = 0; index < lines.length && keep.size < 6; index++) {
            const line = lines[index];
            if (/\b[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*\s*\(/.test(line)) {
                keep.add(index);
            }
        }
    }
    const compact = [...keep]
        .sort((left, right) => left - right)
        .slice(0, 6)
        .map(index => lines[index]);
    return {
        ...snippet,
        code: compact.join("\n"),
    };
}

function collectCfgNeighborTexts(stmt: any, radius: number): string[] | undefined {
    const cfg = stmt?.getCfg?.();
    if (!cfg || typeof cfg.getStmts !== "function") return undefined;
    const stmts: any[] = cfg.getStmts();
    const idx = stmts.indexOf(stmt);
    if (idx < 0) return undefined;
    const out: string[] = [];
    const lo = Math.max(0, idx - radius);
    const hi = Math.min(stmts.length - 1, idx + radius);
    for (let i = lo; i <= hi; i++) {
        const s = stmts[i];
        const t = typeof s?.getOriginalText === "function" ? s.getOriginalText() : undefined;
        out.push(String(t ?? s?.toString?.() ?? "<stmt>"));
    }
    return out;
}

export function buildSceneForProjectDir(projectAbs: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectAbs);
    injectArkUiSdk(config as any);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

export function findCallsiteSlicesInScene(input: {
    scene: Scene;
    repoRoot: string;
    item: NormalizedCallsiteItem;
    maxExamples: number;
    contextRadius: number;
    cfgNeighborRadius: number;
}): CallsiteContextSlice[] {
    const { scene, repoRoot, item, maxExamples, contextRadius, cfgNeighborRadius } = input;
    const out: CallsiteContextSlice[] = [];
    for (const method of scene.getMethods()) {
        if (out.length >= maxExamples) break;
        const cfg = method.getCfg();
        if (!cfg) continue;
        const callerSignature = method.getSignature?.()?.toString?.() || "";
        const callerFilePath = extractFilePathFromMethodSignature(callerSignature);
        for (const stmt of cfg.getStmts()) {
            if (out.length >= maxExamples) break;
            if (!stmt?.containsInvokeExpr?.()) continue;
            const invokeExpr = stmt.getInvokeExpr?.();
            if (!(invokeExpr instanceof ArkInstanceInvokeExpr)
                && !(invokeExpr instanceof ArkStaticInvokeExpr)
                && !(invokeExpr instanceof ArkPtrInvokeExpr)) {
                continue;
            }
            if (!itemMatchesInvoke(item, invokeExpr)) continue;
            const pos = stmt.getOriginPositionInfo?.();
            const lineNo = typeof pos?.getLineNo === "function" ? pos.getLineNo() : -1;
            if (!lineNo || lineNo < 1) continue;
            const absCaller = resolveCallerFile(repoRoot, callerFilePath);
            const lines = absCaller ? readSourceLines(absCaller) : undefined;
            const windowLines = lines ? formatLineWindow(lines, lineNo, contextRadius) : "";
            const invokeStmtText = String(
                typeof stmt.getOriginalText === "function" ? stmt.getOriginalText() : stmt.toString?.() ?? "",
            );
            const neighbors = collectCfgNeighborTexts(stmt, cfgNeighborRadius);
            out.push({
                callerFile: normalizeSlashes(callerFilePath),
                callerMethod: method.getName?.(),
                invokeLine: lineNo,
                invokeStmtText,
                windowLines: windowLines || `(source window unavailable; stmt: ${invokeStmtText.slice(0, 400)})`,
                cfgNeighborStmts: neighbors,
            });
        }
    }
    return out;
}

export interface EnrichCallsiteSlicesOptions {
    repoRoot: string;
    sourceDirs: string[];
    items: any[];
    /** Max feedback items (after sort by count) to enrich */
    maxItems: number;
    /** Example callsites per item */
    maxExamplesPerItem: number;
    /** Lines before/after invoke line in source file */
    contextRadius: number;
    /** CFG stmt neighbors each side */
    cfgNeighborRadius: number;
}

export function enrichNoCandidateItemsWithCallsiteSlices(options: EnrichCallsiteSlicesOptions): NormalizedCallsiteItem[] {
    const {
        repoRoot,
        sourceDirs,
        items,
        maxItems,
        maxExamplesPerItem,
        contextRadius,
        cfgNeighborRadius,
    } = options;
    const normalized = items.map(normalizeNoCandidateItem);
    const ranked = [...normalized].sort((a, b) => (b.count || 0) - (a.count || 0) || a.callee_signature.localeCompare(b.callee_signature));
    const picked = ranked.slice(0, Math.max(0, maxItems));
    const pickedKeys = new Set(
        picked.map(p => `${p.callee_signature}|${p.method}|${p.invokeKind}|${p.argCount}|${p.sourceFile}`),
    );

    const scenes: Scene[] = [];
    for (const sd of sourceDirs) {
        const abs = path.resolve(repoRoot, sd);
        if (!fs.existsSync(abs)) continue;
        try {
            scenes.push(buildSceneForProjectDir(abs));
        } catch {
            /* scene build failed for this sourceDir; skip */
        }
    }

    return normalized.map(item => {
        const key = `${item.callee_signature}|${item.method}|${item.invokeKind}|${item.argCount}|${item.sourceFile}`;
        const shouldEnrich = pickedKeys.has(key);
        if (!shouldEnrich) {
            return item;
        }
        const sourceAbsPath = resolveProjectSourceFile(repoRoot, sourceDirs, item.sourceFile);
        const methodSnippet = sourceAbsPath
            ? extractMethodSnippetFromFile(sourceAbsPath, item.method)
            : undefined;
        const ownerClassName = extractOwnerClassNameFromMethodSignature(item.callee_signature);
        const ownerMethods = sourceAbsPath && ownerClassName
            ? extractOwnerMethodSnippetsFromFile(sourceAbsPath, ownerClassName)
            : [];
        const ownerMethodSnippets = methodSnippet
            ? selectOwnerFamilySnippets(ownerMethods, item.method, methodSnippet, 2)
                .map(snippet => compactOwnerMethodSnippet(methodSnippet, snippet))
            : [];
        const ownerSnippet = sourceAbsPath && methodSnippet
            ? buildCompactOwnerSnippet(
                sourceAbsPath,
                ownerMethods,
                [item.method, ...ownerMethodSnippets.map(entry => entry.method)],
                [methodSnippet, ...ownerMethodSnippets.map(entry => entry.code)],
            )
            : undefined;
        const carrierContext = sourceAbsPath
            ? extractSharedCarrierContextFromFile(sourceAbsPath, item.method)
            : undefined;
        if (scenes.length === 0) {
            return {
                ...item,
                contextSlices: [],
                ...(methodSnippet ? { methodSnippet } : {}),
                ...(ownerSnippet ? { ownerSnippet } : {}),
                ...(ownerMethodSnippets.length > 0 ? { ownerMethodSnippets } : {}),
                ...(carrierContext ? {
                    methodSnippet: methodSnippet || item.methodSnippet,
                    carrierRoots: carrierContext.roots,
                    carrierObservations: carrierContext.observations,
                    carrierSnippet: carrierContext.contextSnippet,
                    carrierMethodSnippets: carrierContext.methodSnippets,
                } : {}),
                contextError: "no_scene_built_for_sourceDirs",
            };
        }
        const slices: CallsiteContextSlice[] = [];
        for (const scene of scenes) {
            if (slices.length >= maxExamplesPerItem) break;
            const found = findCallsiteSlicesInScene({
                scene,
                repoRoot,
                item,
                maxExamples: maxExamplesPerItem - slices.length,
                contextRadius,
                cfgNeighborRadius,
            });
            slices.push(...found);
        }
        if (slices.length === 0) {
            return {
                ...item,
                contextSlices: [],
                methodSnippet,
                ownerSnippet,
                ownerMethodSnippets,
                ...(carrierContext ? {
                    carrierRoots: carrierContext.roots,
                    carrierObservations: carrierContext.observations,
                    carrierSnippet: carrierContext.contextSnippet,
                    carrierMethodSnippets: carrierContext.methodSnippets,
                } : {}),
                contextError: "no_matching_invoke_found_in_scene",
            };
        }
        return {
            ...item,
            contextSlices: slices,
            ...(methodSnippet ? { methodSnippet } : {}),
            ...(ownerSnippet ? { ownerSnippet } : {}),
            ...(ownerMethodSnippets.length > 0 ? { ownerMethodSnippets } : {}),
            ...(carrierContext ? {
                methodSnippet: methodSnippet || item.methodSnippet,
                carrierRoots: carrierContext.roots,
                carrierObservations: carrierContext.observations,
                carrierSnippet: carrierContext.contextSnippet,
                carrierMethodSnippets: carrierContext.methodSnippets,
            } : {}),
        };
    });
}
