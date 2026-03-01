import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { ArkAssignStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkParameterRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import {
    CandidateSelectionResult,
    CandidateSelectorOptions,
    EntryCandidate,
    ResolvedEntry,
} from "./SmokeTypes";
import * as fs from "fs";
import * as path from "path";

export interface SmokeEntrySelectionConfig {
    sourceNamePattern: RegExp;
    sinkKeywords: string[];
    entryMethodHints: ReadonlySet<string>;
}

const LIBRARY_ENTRY_INDEX_HINTS = ["index.ets", "api.ets"];
const EXPORT_FUNCTION_PATTERN = /\bexport\s+function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
const EXPORT_CONST_FUNC_PATTERN = /\bexport\s+(?:const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?(?:\(|[A-Za-z_$])/g;
const exportFunctionNameCache = new Map<string, Set<string>>();

export function extractArkFileFromSignature(signature: string): string | undefined {
    const m = signature.match(/<@([^:>]+\.ets):/);
    if (m) return m[1].replace(/\\/g, "/");
    const m2 = signature.match(/@([^:>]+\.ets):/);
    if (m2) return m2[1].replace(/\\/g, "/");
    return undefined;
}

export function getParameterLocalNames(entryMethod: any): Set<string> {
    const names = new Set<string>();
    const cfg = entryMethod.getCfg();
    if (!cfg) return names;

    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        if (!(stmt.getRightOp() instanceof ArkParameterRef)) continue;
        const leftOp = stmt.getLeftOp();
        if (leftOp instanceof Local) names.add(leftOp.getName());
    }
    return names;
}

export function getSourceLikeLocals(entryMethod: any, sourceNamePattern: RegExp): string[] {
    const body = entryMethod.getBody();
    if (!body) return [];
    const out: string[] = [];
    for (const local of body.getLocals().values()) {
        const name = local.getName();
        if (sourceNamePattern.test(name)) {
            out.push(name);
        }
    }
    return out;
}

function normalizeLowerList(values: string[] | undefined): string[] {
    if (!values) return [];
    return values
        .map(v => String(v || "").trim().toLowerCase())
        .filter(v => v.length > 0);
}

function matchesAny(text: string, patterns: string[]): boolean {
    if (patterns.length === 0) return false;
    const lower = text.toLowerCase();
    return patterns.some(p => lower.includes(p));
}

function collectExportedFunctionNames(sourceDirAbs?: string): Set<string> {
    if (!sourceDirAbs) return new Set<string>();
    const normalizedRoot = path.resolve(sourceDirAbs).replace(/\\/g, "/").toLowerCase();
    const cached = exportFunctionNameCache.get(normalizedRoot);
    if (cached) return cached;

    const exportedNames = new Set<string>();
    if (!fs.existsSync(sourceDirAbs)) {
        exportFunctionNameCache.set(normalizedRoot, exportedNames);
        return exportedNames;
    }

    const stack = [sourceDirAbs];
    while (stack.length > 0) {
        const current = stack.pop()!;
        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
                continue;
            }
            if (!entry.isFile() || !entry.name.endsWith(".ets")) continue;

            let text = "";
            try {
                text = fs.readFileSync(fullPath, "utf-8");
            } catch {
                continue;
            }
            for (const m of text.matchAll(EXPORT_FUNCTION_PATTERN)) {
                const name = String(m[1] || "").trim();
                if (name) exportedNames.add(name);
            }
            for (const m of text.matchAll(EXPORT_CONST_FUNC_PATTERN)) {
                const name = String(m[1] || "").trim();
                if (name) exportedNames.add(name);
            }
        }
    }

    exportFunctionNameCache.set(normalizedRoot, exportedNames);
    return exportedNames;
}

function detectLibraryMode(candidates: EntryCandidate[]): boolean {
    if (candidates.length === 0) return false;
    return !candidates.some(candidate => {
        const sigLower = candidate.signature.toLowerCase();
        const nameLower = candidate.name.toLowerCase();
        return sigLower.includes("/entryability/")
            || sigLower.includes("/pages/")
            || sigLower.includes("/view/")
            || sigLower.includes("/viewmodel/")
            || nameLower === "build"
            || nameLower === "onwindowstagecreate"
            || nameLower === "oncreate"
            || nameLower === "onnewwant"
            || nameLower === "abouttoappear";
    });
}

function computeLibraryEntryBoost(candidate: EntryCandidate, exportedNames: Set<string>): number {
    let boost = 0;
    if (exportedNames.has(candidate.name)) {
        boost += 80;
    }
    const pathLower = String(candidate.pathHint || "").toLowerCase();
    if (LIBRARY_ENTRY_INDEX_HINTS.some(hint => pathLower.endsWith(hint) || pathLower.includes(`/${hint}`))) {
        boost += 20;
    }
    return boost;
}

function scoreEntry(
    method: any,
    signature: string,
    entryHints: string[],
    config: SmokeEntrySelectionConfig
): number {
    const name = method.getName();
    const nameLower = name.toLowerCase();
    const sigLower = signature.toLowerCase();
    const paramCount = getParameterLocalNames(method).size;
    const sourceLikeCount = getSourceLikeLocals(method, config.sourceNamePattern).length;

    let score = 0;
    if (sigLower.includes("/entryability/")) score += 50;
    if (sigLower.includes("/pages/")) score += 40;
    if (sigLower.includes("/viewmodel/")) score += 30;
    if (sigLower.includes("/view/")) score += 20;

    if (nameLower === "build") score += 35;
    if (nameLower.startsWith("on")) score += 25;
    if (config.entryMethodHints.has(nameLower)) score += 20;

    if (paramCount > 0) score += 15;
    if (sourceLikeCount > 0) score += 10;

    for (const keyword of config.sinkKeywords) {
        if (sigLower.includes(keyword.toLowerCase())) {
            score += 4;
        }
    }
    if (matchesAny(nameLower, entryHints)) score += 20;
    if (matchesAny(sigLower, entryHints)) score += 12;
    return score;
}

export function findEntryMethod(scene: Scene, entry: ResolvedEntry): any | undefined {
    const candidates = scene.getMethods().filter(m => m.getName() === entry.name);
    if (entry.pathHint) {
        const normalizedHint = entry.pathHint.replace(/\\/g, "/");
        const hinted = candidates.find(m => m.getSignature().toString().includes(normalizedHint));
        if (hinted) return hinted;
    }
    return candidates[0];
}

export function selectEntryCandidates(
    scene: Scene,
    sourceDirRel: string,
    maxEntries: number,
    selector: CandidateSelectorOptions,
    config: SmokeEntrySelectionConfig,
    sourceDirAbs?: string
): CandidateSelectionResult {
    const candidates: EntryCandidate[] = [];
    const dedup = new Set<string>();
    const includePaths = normalizeLowerList(selector.includePaths);
    const excludePaths = normalizeLowerList(selector.excludePaths);
    const entryHints = normalizeLowerList(selector.entryHints);
    for (const method of scene.getMethods()) {
        if (method.getName() === "%dflt") continue;
        if (!method.getCfg() || !method.getBody()) continue;

        const signature = method.getSignature().toString().replace(/\\/g, "/");
        const pathHint = extractArkFileFromSignature(signature);
        if (!pathHint) continue;

        const key = `${method.getName()}|${pathHint}`;
        if (dedup.has(key)) continue;
        dedup.add(key);

        const score = scoreEntry(method, signature, entryHints, config);
        candidates.push({
            name: method.getName(),
            pathHint,
            signature,
            score,
            sourceDir: sourceDirRel,
            sourceFile: pathHint.toLowerCase(),
        });
    }

    if (detectLibraryMode(candidates)) {
        const exportedNames = collectExportedFunctionNames(sourceDirAbs);
        if (exportedNames.size > 0) {
            for (const candidate of candidates) {
                candidate.score += computeLibraryEntryBoost(candidate, exportedNames);
            }
        }
    }

    const poolTotal = candidates.length;
    const poolFileCount = new Set(candidates.map(c => c.sourceFile || "")).size;

    const filtered = candidates.filter(candidate => {
        const text = `${candidate.signature} ${candidate.pathHint || ""}`.toLowerCase();
        if (excludePaths.length > 0 && matchesAny(text, excludePaths)) {
            return false;
        }
        if (includePaths.length > 0 && !matchesAny(text, includePaths)) {
            return false;
        }
        return true;
    });

    filtered.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.signature !== b.signature) return a.signature.localeCompare(b.signature);
        return a.name.localeCompare(b.name);
    });

    const selected = filtered.slice(0, maxEntries);
    const filteredFileCount = new Set(filtered.map(c => c.sourceFile || "")).size;
    const selectedFileCount = new Set(selected.map(c => c.sourceFile || "")).size;

    return {
        selected,
        poolTotal,
        filteredTotal: filtered.length,
        poolFileCount,
        filteredFileCount,
        selectedFileCount,
    };
}
