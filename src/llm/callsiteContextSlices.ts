import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../arkanalyzer/lib/Scene";
import { SceneConfig } from "../../arkanalyzer/lib/Config";
import { ArkInstanceInvokeExpr, ArkPtrInvokeExpr, ArkStaticInvokeExpr } from "../../arkanalyzer/lib/core/base/Expr";
import { injectArkUiSdk } from "../core/orchestration/ArkUiSdkConfig";

export interface NormalizedCallsiteItem {
    callee_signature: string;
    method: string;
    invokeKind: "instance" | "static" | "any";
    argCount: number;
    sourceFile: string;
    count?: number;
    topEntries?: string[];
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
        if (scenes.length === 0) {
            return {
                ...item,
                contextSlices: [],
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
                contextError: "no_matching_invoke_found_in_scene",
            };
        }
        return {
            ...item,
            contextSlices: slices,
        };
    });
}
