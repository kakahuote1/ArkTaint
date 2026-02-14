import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../core/TaintPropagationEngine";
import { ArkAssignStmt } from "../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceInvokeExpr, ArkPtrInvokeExpr, ArkStaticInvokeExpr } from "../../arkanalyzer/out/src/core/base/Expr";
import { ArkArrayRef, ArkInstanceFieldRef, ArkParameterRef, ClosureFieldRef } from "../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../arkanalyzer/out/src/core/base/Local";
import * as fs from "fs";
import * as path from "path";

interface SmokeProjectConfig {
    id: string;
    repoPath: string;
    repoUrl?: string;
    license?: string;
    sourceMode?: "single" | "multi-module";
    priority?: "main" | "stress";
    commit?: string;
    sourceDirs: string[];
    tags?: string[];
    entryHints?: string[];
    includePaths?: string[];
    excludePaths?: string[];
    sinkSignatures?: string[];
    enabled?: boolean;
}

interface SmokeManifest {
    projects: SmokeProjectConfig[];
}

interface CliOptions {
    manifestPath: string;
    k: number;
    maxEntries: number;
    outputDir: string;
    projectFilter?: string;
}

interface ResolvedEntry {
    name: string;
    pathHint?: string;
}

interface EntryCandidate extends ResolvedEntry {
    signature: string;
    score: number;
    sourceDir: string;
    sourceFile?: string;
}

interface EntrySmokeResult {
    sourceDir: string;
    entryName: string;
    entryPathHint?: string;
    signature: string;
    score: number;
    status: "ok" | "no_entry" | "no_body" | "no_seed" | "exception";
    seedLocalNames: string[];
    seedStrategies: string[];
    seedCount: number;
    flowCount: number;
    sinkFlowByKeyword: Record<string, number>;
    sinkFlowBySignature: Record<string, number>;
    sinkSamples: string[];
    error?: string;
    elapsedMs: number;
}

interface SourceDirSummary {
    sourceDir: string;
    candidatePoolTotal: number;
    candidateAfterPathFilter: number;
    selected: number;
    entryCoverageRate: number;
    filePoolTotal: number;
    fileAfterPathFilter: number;
    fileCovered: number;
    fileCoverageRate: number;
    analyzed: number;
    withSeeds: number;
    withFlows: number;
    totalFlows: number;
    statusCount: Record<string, number>;
}

interface ProjectSmokeResult {
    id: string;
    repoPath: string;
    repoUrl?: string;
    license?: string;
    sourceMode?: "single" | "multi-module";
    priority?: "main" | "stress";
    commit?: string;
    tags: string[];
    sourceDirs: string[];
    sourceSummaries: SourceDirSummary[];
    entries: EntrySmokeResult[];
    sinkSignatures: string[];
    analyzed: number;
    withSeeds: number;
    withFlows: number;
    totalFlows: number;
    sinkFlowByKeyword: Record<string, number>;
    sinkFlowBySignature: Record<string, number>;
    fatalErrors: string[];
}

interface SmokeReport {
    generatedAt: string;
    options: CliOptions;
    projects: ProjectSmokeResult[];
    totalProjects: number;
    totalAnalyzedEntries: number;
    totalEntriesWithSeeds: number;
    totalEntriesWithFlows: number;
    totalFlows: number;
    sinkFlowByKeyword: Record<string, number>;
    sinkFlowBySignature: Record<string, number>;
    fatalProjectCount: number;
}

const SOURCE_NAME_PATTERN = /(taint_src|input|url|uri|path|query|param|params|msg|message|text|content|payload|token|password|pwd|phone|email|name|id|data)/i;
const INIT_NAME_PATTERN = /(data|state|model|info|result|resp|response|record|entity|item|user|token|msg|payload|query|param|url|uri|path|text|content|name|id)/i;
const INIT_CALLEE_PATTERN = /(get|fetch|load|query|request|read|find|resolve|parse|decode|open|from)/i;
const CALLBACK_INVOKE_HINTS = new Set([
    "onclick",
    "onchange",
    "onsubmit",
    "then",
    "catch",
    "finally",
    "foreach",
    "map",
    "filter",
    "reduce",
    "subscribe",
    "emit",
    "register",
    "listen",
    "addlistener",
    "settimeout",
    "setinterval",
]);
const SINK_KEYWORDS = [
    "axios",
    "fetch",
    "request",
    "router",
    "pushUrl",
    "relationalStore",
    "rdb",
    "preferences",
    "console",
];

const DEFAULT_SINK_SIGNATURE_PATTERNS = [
    "router.pushUrl",
    "router.back",
    "router.getParams",
    "fetch(",
    "axios.get",
    "axios.post",
    "relationalStore",
    "getRdbStore",
    "execDML",
    "execDQL",
    "insertSync",
    "querySqlSync",
    "preferences.getPreferencesSync",
    "dataPreferences.putSync",
    "dataPreferences.getSync",
    "dataPreferences.deleteSync",
];

const ENTRY_METHOD_HINTS = new Set([
    "build",
    "onwindowstagecreate",
    "oncreate",
    "onforeground",
    "abouttoappear",
    "onclick",
    "pushurl",
]);

interface CandidateSelectorOptions {
    includePaths: string[];
    excludePaths: string[];
    entryHints: string[];
}

interface CandidateSelectionResult {
    selected: EntryCandidate[];
    poolTotal: number;
    filteredTotal: number;
    poolFileCount: number;
    filteredFileCount: number;
    selectedFileCount: number;
}

function parseArgs(argv: string[]): CliOptions {
    let manifestPath = "tests/manifests/smoke_projects.json";
    let k = 1;
    let maxEntries = 12;
    let outputDir = "tmp/phase43";
    let projectFilter: string | undefined;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--manifest" && i + 1 < argv.length) {
            manifestPath = argv[++i];
            continue;
        }
        if (arg.startsWith("--manifest=")) {
            manifestPath = arg.slice("--manifest=".length);
            continue;
        }
        if (arg === "--k" && i + 1 < argv.length) {
            k = Number(argv[++i]);
            continue;
        }
        if (arg.startsWith("--k=")) {
            k = Number(arg.slice("--k=".length));
            continue;
        }
        if (arg === "--maxEntries" && i + 1 < argv.length) {
            maxEntries = Number(argv[++i]);
            continue;
        }
        if (arg.startsWith("--maxEntries=")) {
            maxEntries = Number(arg.slice("--maxEntries=".length));
            continue;
        }
        if (arg === "--outputDir" && i + 1 < argv.length) {
            outputDir = argv[++i];
            continue;
        }
        if (arg.startsWith("--outputDir=")) {
            outputDir = arg.slice("--outputDir=".length);
            continue;
        }
        if (arg === "--project" && i + 1 < argv.length) {
            projectFilter = argv[++i];
            continue;
        }
        if (arg.startsWith("--project=")) {
            projectFilter = arg.slice("--project=".length);
            continue;
        }
    }

    if (k !== 0 && k !== 1) {
        throw new Error(`Invalid --k value: ${k}. Expected 0 or 1.`);
    }
    if (!Number.isFinite(maxEntries) || maxEntries <= 0) {
        throw new Error(`Invalid --maxEntries value: ${maxEntries}. Expected positive integer.`);
    }

    return {
        manifestPath,
        k,
        maxEntries: Math.floor(maxEntries),
        outputDir,
        projectFilter,
    };
}

function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

function readManifest(manifestPath: string): SmokeManifest {
    const abs = path.isAbsolute(manifestPath) ? manifestPath : path.resolve(manifestPath);
    if (!fs.existsSync(abs)) {
        throw new Error(`Manifest file not found: ${abs}`);
    }
    const parsed = JSON.parse(fs.readFileSync(abs, "utf-8")) as SmokeManifest;
    if (!parsed.projects || !Array.isArray(parsed.projects)) {
        throw new Error(`Invalid manifest format: missing projects[] in ${abs}`);
    }
    return parsed;
}

function extractArkFileFromSignature(signature: string): string | undefined {
    const m = signature.match(/<@([^:>]+\.ets):/);
    if (m) return m[1].replace(/\\/g, "/");
    const m2 = signature.match(/@([^:>]+\.ets):/);
    if (m2) return m2[1].replace(/\\/g, "/");
    return undefined;
}

function getParameterLocalNames(entryMethod: any): Set<string> {
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

function getSourceLikeLocals(entryMethod: any): string[] {
    const body = entryMethod.getBody();
    if (!body) return [];
    const out: string[] = [];
    for (const local of body.getLocals().values()) {
        const name = local.getName();
        if (SOURCE_NAME_PATTERN.test(name)) {
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

function normalizeSignatureList(values: string[] | undefined): string[] {
    if (!values) return [];
    const dedup = new Set<string>();
    for (const v of values) {
        const s = String(v || "").trim();
        if (!s) continue;
        dedup.add(s);
    }
    return [...dedup];
}

function resolveProjectSinkSignatures(project: SmokeProjectConfig): string[] {
    const custom = normalizeSignatureList(project.sinkSignatures);
    if (custom.length > 0) return custom;
    return normalizeSignatureList(DEFAULT_SINK_SIGNATURE_PATTERNS);
}

function matchesAny(text: string, patterns: string[]): boolean {
    if (patterns.length === 0) return false;
    const lower = text.toLowerCase();
    return patterns.some(p => lower.includes(p));
}

function scoreEntry(method: any, signature: string, entryHints: string[]): number {
    const name = method.getName();
    const nameLower = name.toLowerCase();
    const sigLower = signature.toLowerCase();
    const paramCount = getParameterLocalNames(method).size;
    const sourceLikeCount = getSourceLikeLocals(method).length;

    let score = 0;
    if (sigLower.includes("/entryability/")) score += 50;
    if (sigLower.includes("/pages/")) score += 40;
    if (sigLower.includes("/viewmodel/")) score += 30;
    if (sigLower.includes("/view/")) score += 20;

    if (nameLower === "build") score += 35;
    if (nameLower.startsWith("on")) score += 25;
    if (ENTRY_METHOD_HINTS.has(nameLower)) score += 20;

    if (paramCount > 0) score += 15;
    if (sourceLikeCount > 0) score += 10;

    for (const keyword of SINK_KEYWORDS) {
        if (sigLower.includes(keyword.toLowerCase())) {
            score += 4;
        }
    }
    if (matchesAny(nameLower, entryHints)) score += 20;
    if (matchesAny(sigLower, entryHints)) score += 12;
    return score;
}

function findEntryMethod(scene: Scene, entry: ResolvedEntry): any | undefined {
    const candidates = scene.getMethods().filter(m => m.getName() === entry.name);
    if (entry.pathHint) {
        const normalizedHint = entry.pathHint.replace(/\\/g, "/");
        const hinted = candidates.find(m => m.getSignature().toString().includes(normalizedHint));
        if (hinted) return hinted;
    }
    return candidates[0];
}

function selectEntryCandidates(
    scene: Scene,
    sourceDirRel: string,
    maxEntries: number,
    selector: CandidateSelectorOptions
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

        const score = scoreEntry(method, signature, entryHints);
        candidates.push({
            name: method.getName(),
            pathHint,
            signature,
            score,
            sourceDir: sourceDirRel,
            sourceFile: pathHint.toLowerCase(),
        });
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

function resolveInvokeMethodName(invokeExpr: any): string {
    if (!invokeExpr) return "";
    const fromSig = invokeExpr.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
    if (fromSig) return String(fromSig);
    const sig = invokeExpr.getMethodSignature?.()?.toString?.() || "";
    const m = sig.match(/\.([A-Za-z0-9_$]+)\(/);
    return m ? m[1] : "";
}

function extractMethodLikeNames(text: string): Set<string> {
    const out = new Set<string>();
    if (!text) return out;

    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text)) {
        out.add(text);
    }

    const amMatches = text.match(/%AM\d+\$[A-Za-z0-9_]+/g) || [];
    for (const m of amMatches) out.add(m);

    const sigMethodMatches = text.matchAll(/\.([A-Za-z0-9_$]+)\(/g);
    for (const m of sigMethodMatches) {
        if (m[1]) out.add(m[1]);
    }

    return out;
}

function resolveCallbackNameCandidates(value: any, visitingLocals: Set<string> = new Set()): Set<string> {
    const names = new Set<string>();
    const text = value?.toString?.() || "";
    const textCandidates = extractMethodLikeNames(text);
    for (const n of textCandidates) names.add(n);

    if (value instanceof Local) {
        const localName = value.getName();
        names.add(localName);
        if (visitingLocals.has(localName)) return names;
        visitingLocals.add(localName);

        const decl = value.getDeclaringStmt();
        if (decl instanceof ArkAssignStmt && decl.getLeftOp() === value) {
            const right = decl.getRightOp();
            if (right instanceof Local) {
                const rhsNames = resolveCallbackNameCandidates(right, visitingLocals);
                for (const n of rhsNames) names.add(n);
            } else if (right instanceof ArkInstanceInvokeExpr || right instanceof ArkStaticInvokeExpr || right instanceof ArkPtrInvokeExpr) {
                const methodName = resolveInvokeMethodName(right);
                if (methodName) names.add(methodName);
            } else {
                const rhsText = right?.toString?.() || "";
                const rhsNames = extractMethodLikeNames(rhsText);
                for (const n of rhsNames) names.add(n);
            }
        }
    }

    return names;
}

function collectMethodParameterLocals(method: any): Local[] {
    const out: Local[] = [];
    const cfg = method.getCfg();
    if (!cfg) return out;
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        if (!(stmt.getRightOp() instanceof ArkParameterRef)) continue;
        const left = stmt.getLeftOp();
        if (left instanceof Local) out.push(left);
    }
    return out;
}

function collectLikelyCallbackMethods(scene: Scene, entryMethod: any): any[] {
    const bySignature = new Map<string, any>();
    const allMethods = scene.getMethods();
    const entryNameLower = String(entryMethod.getName() || "").toLowerCase();
    const entrySig = entryMethod.getSignature()?.toString?.() || "";
    const entryFile = extractArkFileFromSignature(entrySig)?.toLowerCase();

    for (const method of allMethods) {
        if (method === entryMethod) continue;
        const methodName = String(method.getName() || "");
        if (!methodName.startsWith("%AM")) continue;
        const sig = method.getSignature()?.toString?.() || "";
        const methodFile = extractArkFileFromSignature(sig)?.toLowerCase();
        if (entryFile && methodFile && methodFile === entryFile && methodName.toLowerCase().includes(`$${entryNameLower}`)) {
            bySignature.set(sig, method);
        }
    }

    const cfg = entryMethod.getCfg();
    if (!cfg) return [...bySignature.values()];
    for (const stmt of cfg.getStmts()) {
        if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
        const invokeExpr = stmt.getInvokeExpr();
        if (!invokeExpr) continue;

        const invokeNameLower = resolveInvokeMethodName(invokeExpr).toLowerCase();
        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        if (args.length === 0) continue;
        const looksLikeCallbackInvoke = CALLBACK_INVOKE_HINTS.has(invokeNameLower) || invokeNameLower.startsWith("on");
        if (!looksLikeCallbackInvoke) continue;

        const callbackNameHints = new Set<string>();
        for (const arg of args) {
            const names = resolveCallbackNameCandidates(arg);
            for (const n of names) callbackNameHints.add(n);
        }
        if (callbackNameHints.size === 0) continue;

        for (const method of allMethods) {
            const methodName = String(method.getName() || "");
            if (!callbackNameHints.has(methodName)) continue;
            const sig = method.getSignature()?.toString?.() || methodName;
            bySignature.set(sig, method);
        }
    }

    return [...bySignature.values()];
}

function localUsedAsInvokeArgument(local: Local): boolean {
    for (const stmt of local.getUsedStmts()) {
        if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
        const invokeExpr = stmt.getInvokeExpr();
        if (!invokeExpr || !invokeExpr.getArgs) continue;
        const args = invokeExpr.getArgs();
        if (args.some((arg: any) => arg === local)) return true;
    }
    return false;
}

function collectInitializationFallbackLocals(entryMethod: any): Local[] {
    const body = entryMethod.getBody();
    if (!body) return [];
    const scored: Array<{ local: Local; score: number }> = [];

    for (const local of body.getLocals().values()) {
        const decl = local.getDeclaringStmt();
        if (!(decl instanceof ArkAssignStmt) || decl.getLeftOp() !== local) continue;

        const right = decl.getRightOp();
        let score = 0;
        const localName = local.getName();
        if (SOURCE_NAME_PATTERN.test(localName)) score += 2;
        if (INIT_NAME_PATTERN.test(localName)) score += 1;

        if (right instanceof ArkInstanceInvokeExpr || right instanceof ArkStaticInvokeExpr || right instanceof ArkPtrInvokeExpr) {
            score += 2;
            const calleeName = resolveInvokeMethodName(right);
            if (INIT_CALLEE_PATTERN.test(calleeName)) score += 1;
        } else if (right instanceof ArkInstanceFieldRef || right instanceof ClosureFieldRef || right instanceof ArkArrayRef) {
            score += 1;
            const rightText = right.toString();
            if (SOURCE_NAME_PATTERN.test(rightText) || INIT_NAME_PATTERN.test(rightText)) score += 1;
        } else if (right instanceof Local) {
            if (SOURCE_NAME_PATTERN.test(right.getName()) || INIT_NAME_PATTERN.test(right.getName())) score += 1;
        }

        if (localUsedAsInvokeArgument(local)) score += 1;
        if (score < 2) continue;
        scored.push({ local, score });
    }

    scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.local.getName().localeCompare(b.local.getName());
    });
    return scored.slice(0, 8).map(x => x.local);
}

function collectSeedNodes(scene: Scene, engine: TaintPropagationEngine, entryMethod: any): { nodes: any[]; localNames: string[]; strategies: string[] } {
    const body = entryMethod.getBody();
    if (!body) return { nodes: [], localNames: [], strategies: [] };

    const paramLocalNames = getParameterLocalNames(entryMethod);
    const localNames = new Set<string>();
    const nodeIds = new Set<number>();
    const strategies = new Set<string>();
    const nodes: any[] = [];

    const addLocalSeed = (local: Local, strategy: string): boolean => {
        const pagNodes = engine.pag.getNodesByValue(local);
        if (!pagNodes || pagNodes.size === 0) return false;
        let added = false;
        for (const nodeId of pagNodes.values()) {
            if (nodeIds.has(nodeId)) continue;
            nodeIds.add(nodeId);
            nodes.push(engine.pag.getNode(nodeId));
            added = true;
        }
        if (added) {
            localNames.add(local.getName());
            strategies.add(strategy);
        }
        return added;
    };

    for (const local of body.getLocals().values()) {
        const localName = local.getName();
        if (paramLocalNames.has(localName)) {
            addLocalSeed(local, "direct:param");
            continue;
        }
        if (SOURCE_NAME_PATTERN.test(localName)) {
            addLocalSeed(local, "direct:source_like_name");
        }
    }

    const callbackMethods = collectLikelyCallbackMethods(scene, entryMethod);
    for (const callbackMethod of callbackMethods) {
        for (const paramLocal of collectMethodParameterLocals(callbackMethod)) {
            addLocalSeed(paramLocal, "callback:param");
        }
    }

    if (nodes.length === 0) {
        for (const local of collectInitializationFallbackLocals(entryMethod)) {
            addLocalSeed(local, "init:cross_function_fallback");
        }
    }

    return {
        nodes,
        localNames: [...localNames].sort(),
        strategies: [...strategies].sort(),
    };
}

function detectFlowsByProfiles(
    engine: TaintPropagationEngine,
    signaturePatterns: string[]
): { totalFlowCount: number; byKeyword: Record<string, number>; bySignature: Record<string, number>; sinkSamples: string[] } {
    const uniqueFlowKeys = new Set<string>();
    const byKeyword: Record<string, number> = {};
    const bySignature: Record<string, number> = {};
    const sinkSamples: string[] = [];

    const collect = (bucket: "keyword" | "signature", token: string): number => {
        const flows = engine.detectSinks(token);
        const bucketKeys = new Set<string>();
        const label = bucket === "keyword" ? `kw:${token}` : `sig:${token}`;
        for (const flow of flows) {
            const sinkText = flow.sink.toString();
            const key = `${flow.source} -> ${sinkText}`;
            bucketKeys.add(key);
            if (!uniqueFlowKeys.has(key)) {
                uniqueFlowKeys.add(key);
                if (sinkSamples.length < 8) {
                    sinkSamples.push(`[${label}] ${sinkText}`);
                }
            }
        }
        return bucketKeys.size;
    };

    for (const keyword of SINK_KEYWORDS) {
        byKeyword[keyword] = collect("keyword", keyword);
    }

    for (const signaturePattern of signaturePatterns) {
        bySignature[signaturePattern] = collect("signature", signaturePattern);
    }

    return {
        totalFlowCount: uniqueFlowKeys.size,
        byKeyword,
        bySignature,
        sinkSamples,
    };
}

async function analyzeEntry(scene: Scene, candidate: EntryCandidate, k: number, signaturePatterns: string[]): Promise<EntrySmokeResult> {
    const t0 = Date.now();
    try {
        const engine = new TaintPropagationEngine(scene, k);
        engine.verbose = false;
        await engine.buildPAG(candidate.name, candidate.pathHint);

        const entryMethod = findEntryMethod(scene, candidate);
        if (!entryMethod) {
            return {
                sourceDir: candidate.sourceDir,
                entryName: candidate.name,
                entryPathHint: candidate.pathHint,
                signature: candidate.signature,
                score: candidate.score,
                status: "no_entry",
                seedLocalNames: [],
                seedStrategies: [],
                seedCount: 0,
                flowCount: 0,
                sinkFlowByKeyword: {},
                sinkFlowBySignature: {},
                sinkSamples: [],
                elapsedMs: Date.now() - t0,
            };
        }

        if (!entryMethod.getBody()) {
            return {
                sourceDir: candidate.sourceDir,
                entryName: candidate.name,
                entryPathHint: candidate.pathHint,
                signature: candidate.signature,
                score: candidate.score,
                status: "no_body",
                seedLocalNames: [],
                seedStrategies: [],
                seedCount: 0,
                flowCount: 0,
                sinkFlowByKeyword: {},
                sinkFlowBySignature: {},
                sinkSamples: [],
                elapsedMs: Date.now() - t0,
            };
        }

        const seeds = collectSeedNodes(scene, engine, entryMethod);
        if (seeds.nodes.length === 0) {
            return {
                sourceDir: candidate.sourceDir,
                entryName: candidate.name,
                entryPathHint: candidate.pathHint,
                signature: candidate.signature,
                score: candidate.score,
                status: "no_seed",
                seedLocalNames: [],
                seedStrategies: [],
                seedCount: 0,
                flowCount: 0,
                sinkFlowByKeyword: {},
                sinkFlowBySignature: {},
                sinkSamples: [],
                elapsedMs: Date.now() - t0,
            };
        }

        engine.propagateWithSeeds(seeds.nodes);
        const detected = detectFlowsByProfiles(engine, signaturePatterns);

        return {
            sourceDir: candidate.sourceDir,
            entryName: candidate.name,
            entryPathHint: candidate.pathHint,
            signature: candidate.signature,
            score: candidate.score,
            status: "ok",
            seedLocalNames: seeds.localNames,
            seedStrategies: seeds.strategies,
            seedCount: seeds.nodes.length,
            flowCount: detected.totalFlowCount,
            sinkFlowByKeyword: detected.byKeyword,
            sinkFlowBySignature: detected.bySignature,
            sinkSamples: detected.sinkSamples,
            elapsedMs: Date.now() - t0,
        };
    } catch (err: any) {
        return {
            sourceDir: candidate.sourceDir,
            entryName: candidate.name,
            entryPathHint: candidate.pathHint,
            signature: candidate.signature,
            score: candidate.score,
            status: "exception",
            seedLocalNames: [],
            seedStrategies: [],
            seedCount: 0,
            flowCount: 0,
            sinkFlowByKeyword: {},
            sinkFlowBySignature: {},
            sinkSamples: [],
            error: String(err?.message || err),
            elapsedMs: Date.now() - t0,
        };
    }
}

function createSourceSummary(sourceDir: string, results: EntrySmokeResult[], selection: CandidateSelectionResult): SourceDirSummary {
    const statusCount: Record<string, number> = {};
    let analyzed = 0;
    let withSeeds = 0;
    let withFlows = 0;
    let totalFlows = 0;

    for (const r of results) {
        statusCount[r.status] = (statusCount[r.status] || 0) + 1;
        analyzed++;
        if (r.seedCount > 0) withSeeds++;
        if (r.flowCount > 0) withFlows++;
        totalFlows += r.flowCount;
    }

    const entryCoverageRate = selection.filteredTotal > 0
        ? Number((analyzed / selection.filteredTotal).toFixed(4))
        : 0;
    const fileCoverageRate = selection.filteredFileCount > 0
        ? Number((selection.selectedFileCount / selection.filteredFileCount).toFixed(4))
        : 0;

    return {
        sourceDir,
        candidatePoolTotal: selection.poolTotal,
        candidateAfterPathFilter: selection.filteredTotal,
        selected: selection.selected.length,
        entryCoverageRate,
        filePoolTotal: selection.poolFileCount,
        fileAfterPathFilter: selection.filteredFileCount,
        fileCovered: selection.selectedFileCount,
        fileCoverageRate,
        analyzed,
        withSeeds,
        withFlows,
        totalFlows,
        statusCount,
    };
}

async function runProject(project: SmokeProjectConfig, options: CliOptions): Promise<ProjectSmokeResult> {
    const repoAbs = path.isAbsolute(project.repoPath) ? project.repoPath : path.resolve(project.repoPath);
    const sourceDirs = project.sourceDirs || [];
    const sinkSignatures = resolveProjectSinkSignatures(project);
    const result: ProjectSmokeResult = {
        id: project.id,
        repoPath: repoAbs,
        repoUrl: project.repoUrl,
        license: project.license,
        sourceMode: project.sourceMode,
        priority: project.priority,
        commit: project.commit,
        tags: project.tags || [],
        sourceDirs,
        sourceSummaries: [],
        entries: [],
        sinkSignatures,
        analyzed: 0,
        withSeeds: 0,
        withFlows: 0,
        totalFlows: 0,
        sinkFlowByKeyword: {},
        sinkFlowBySignature: {},
        fatalErrors: [],
    };

    if (!fs.existsSync(repoAbs)) {
        result.fatalErrors.push(`repo_path_missing: ${repoAbs}`);
        return result;
    }

    const perSourceMax = Math.max(1, Math.floor(options.maxEntries / Math.max(1, sourceDirs.length)));

    for (const sourceDir of sourceDirs) {
        const sourceAbs = path.resolve(repoAbs, sourceDir);
        if (!fs.existsSync(sourceAbs)) {
            result.fatalErrors.push(`source_dir_missing: ${sourceAbs}`);
            continue;
        }

        let scene: Scene;
        try {
            const config = new SceneConfig();
            config.buildFromProjectDir(sourceAbs);
            scene = new Scene();
            scene.buildSceneFromProjectDir(config);
            scene.inferTypes();
        } catch (err: any) {
            result.fatalErrors.push(`build_scene_failed(${sourceDir}): ${String(err?.message || err)}`);
            continue;
        }

        const selection = selectEntryCandidates(scene, sourceDir, perSourceMax, {
            includePaths: project.includePaths || [],
            excludePaths: project.excludePaths || [],
            entryHints: project.entryHints || [],
        });
        const sourceResults: EntrySmokeResult[] = [];
        for (const candidate of selection.selected) {
            const r = await analyzeEntry(scene, candidate, options.k, sinkSignatures);
            sourceResults.push(r);
            result.entries.push(r);
        }

        const summary = createSourceSummary(sourceDir, sourceResults, selection);
        result.sourceSummaries.push(summary);
    }

    for (const entry of result.entries) {
        result.analyzed++;
        if (entry.seedCount > 0) result.withSeeds++;
        if (entry.flowCount > 0) result.withFlows++;
        result.totalFlows += entry.flowCount;
        for (const keyword of Object.keys(entry.sinkFlowByKeyword)) {
            result.sinkFlowByKeyword[keyword] = (result.sinkFlowByKeyword[keyword] || 0) + entry.sinkFlowByKeyword[keyword];
        }
        for (const signature of Object.keys(entry.sinkFlowBySignature)) {
            result.sinkFlowBySignature[signature] = (result.sinkFlowBySignature[signature] || 0) + entry.sinkFlowBySignature[signature];
        }
    }

    return result;
}

function aggregateReport(options: CliOptions, projects: ProjectSmokeResult[]): SmokeReport {
    const sinkFlowByKeyword: Record<string, number> = {};
    const sinkFlowBySignature: Record<string, number> = {};
    let totalAnalyzedEntries = 0;
    let totalEntriesWithSeeds = 0;
    let totalEntriesWithFlows = 0;
    let totalFlows = 0;
    let fatalProjectCount = 0;

    for (const p of projects) {
        totalAnalyzedEntries += p.analyzed;
        totalEntriesWithSeeds += p.withSeeds;
        totalEntriesWithFlows += p.withFlows;
        totalFlows += p.totalFlows;
        if (p.fatalErrors.length > 0) fatalProjectCount++;

        for (const keyword of Object.keys(p.sinkFlowByKeyword)) {
            sinkFlowByKeyword[keyword] = (sinkFlowByKeyword[keyword] || 0) + p.sinkFlowByKeyword[keyword];
        }
        for (const signature of Object.keys(p.sinkFlowBySignature)) {
            sinkFlowBySignature[signature] = (sinkFlowBySignature[signature] || 0) + p.sinkFlowBySignature[signature];
        }
    }

    return {
        generatedAt: new Date().toISOString(),
        options,
        projects,
        totalProjects: projects.length,
        totalAnalyzedEntries,
        totalEntriesWithSeeds,
        totalEntriesWithFlows,
        totalFlows,
        sinkFlowByKeyword,
        sinkFlowBySignature,
        fatalProjectCount,
    };
}

function renderMarkdownReport(report: SmokeReport): string {
    const lines: string[] = [];
    lines.push("# Phase 4.3 Smoke Report");
    lines.push("");
    lines.push(`- generatedAt: ${report.generatedAt}`);
    lines.push(`- manifest: ${report.options.manifestPath}`);
    lines.push(`- k: ${report.options.k}`);
    lines.push(`- maxEntries: ${report.options.maxEntries}`);
    lines.push(`- projects: ${report.totalProjects}`);
    lines.push(`- analyzed entries: ${report.totalAnalyzedEntries}`);
    lines.push(`- entries with seeds: ${report.totalEntriesWithSeeds}`);
    lines.push(`- entries with flows: ${report.totalEntriesWithFlows}`);
    lines.push(`- total flows: ${report.totalFlows}`);
    lines.push(`- fatal projects: ${report.fatalProjectCount}`);
    lines.push("");

    lines.push("## Sink Flow Totals (Keyword)");
    lines.push("");
    for (const keyword of Object.keys(report.sinkFlowByKeyword).sort()) {
        lines.push(`- ${keyword}: ${report.sinkFlowByKeyword[keyword]}`);
    }
    lines.push("");

    lines.push("## Sink Flow Totals (Signature)");
    lines.push("");
    for (const signature of Object.keys(report.sinkFlowBySignature).sort()) {
        lines.push(`- ${signature}: ${report.sinkFlowBySignature[signature]}`);
    }
    lines.push("");

    for (const project of report.projects) {
        lines.push(`## Project: ${project.id}`);
        lines.push("");
        lines.push(`- repoPath: ${project.repoPath}`);
        lines.push(`- repoUrl: ${project.repoUrl || "N/A"}`);
        lines.push(`- license: ${project.license || "N/A"}`);
        lines.push(`- sourceMode: ${project.sourceMode || "N/A"}`);
        lines.push(`- priority: ${project.priority || "N/A"}`);
        lines.push(`- commit: ${project.commit || "N/A"}`);
        lines.push(`- tags: ${(project.tags || []).join(", ") || "N/A"}`);
        lines.push(`- sourceDirs: ${project.sourceDirs.join(", ")}`);
        lines.push(`- sinkSignatures: ${project.sinkSignatures.join(", ") || "N/A"}`);
        lines.push(`- analyzed: ${project.analyzed}`);
        lines.push(`- withSeeds: ${project.withSeeds}`);
        lines.push(`- withFlows: ${project.withFlows}`);
        lines.push(`- totalFlows: ${project.totalFlows}`);
        if (project.fatalErrors.length > 0) {
            lines.push("- fatalErrors:");
            for (const err of project.fatalErrors) {
                lines.push(`  - ${err}`);
            }
        }
        lines.push("");
        lines.push("### Source Summaries");
        for (const s of project.sourceSummaries) {
            lines.push(`- ${s.sourceDir}: pool=${s.candidatePoolTotal}, filtered=${s.candidateAfterPathFilter}, selected=${s.selected}, entryCoverage=${(s.entryCoverageRate * 100).toFixed(1)}%, fileCoverage=${(s.fileCoverageRate * 100).toFixed(1)}%, analyzed=${s.analyzed}, withSeeds=${s.withSeeds}, withFlows=${s.withFlows}, totalFlows=${s.totalFlows}, status=${JSON.stringify(s.statusCount)}`);
        }
        lines.push("");

        const topEntries = [...project.entries]
            .sort((a, b) => {
                if (b.flowCount !== a.flowCount) return b.flowCount - a.flowCount;
                if (b.seedCount !== a.seedCount) return b.seedCount - a.seedCount;
                return b.score - a.score;
            })
            .slice(0, 8);
        lines.push("### Top Entries");
        for (const e of topEntries) {
            const strategyText = e.seedStrategies.length > 0 ? e.seedStrategies.join(",") : "N/A";
            lines.push(`- ${e.entryName} @ ${e.entryPathHint || "N/A"} | status=${e.status} | flows=${e.flowCount} | seeds=${e.seedCount} | seedBy=${strategyText} | score=${e.score}`);
            if (e.sinkSamples.length > 0) {
                for (const sample of e.sinkSamples.slice(0, 3)) {
                    lines.push(`  - ${sample}`);
                }
            }
        }
        lines.push("");
    }

    return lines.join("\n");
}

function printConsoleSummary(report: SmokeReport): void {
    console.log("\n====== Phase 4.3 Smoke Summary ======");
    console.log(`projects=${report.totalProjects}`);
    console.log(`analyzed_entries=${report.totalAnalyzedEntries}`);
    console.log(`entries_with_seeds=${report.totalEntriesWithSeeds}`);
    console.log(`entries_with_flows=${report.totalEntriesWithFlows}`);
    console.log(`total_flows=${report.totalFlows}`);
    console.log(`fatal_projects=${report.fatalProjectCount}`);

    console.log("\n------ projects ------");
    for (const p of report.projects) {
        const coverage =
            p.sourceSummaries.length > 0
                ? p.sourceSummaries.reduce((acc, s) => acc + s.entryCoverageRate, 0) / p.sourceSummaries.length
                : 0;
        console.log(`  ${p.id.padEnd(30)} priority=${(p.priority || "N/A").padEnd(6)} analyzed=${String(p.analyzed).padEnd(3)} withSeeds=${String(p.withSeeds).padEnd(3)} withFlows=${String(p.withFlows).padEnd(3)} totalFlows=${String(p.totalFlows).padEnd(3)} cov=${(coverage * 100).toFixed(1)}% fatal=${p.fatalErrors.length}`);
    }

    console.log("\n------ sink flow totals ------");
    for (const keyword of Object.keys(report.sinkFlowByKeyword).sort()) {
        console.log(`  ${keyword.padEnd(20)} ${report.sinkFlowByKeyword[keyword]}`);
    }
    console.log("\n------ sink flow totals (signature) ------");
    for (const signature of Object.keys(report.sinkFlowBySignature).sort()) {
        console.log(`  ${signature.padEnd(32)} ${report.sinkFlowBySignature[signature]}`);
    }
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const manifest = readManifest(options.manifestPath);
    let projects = manifest.projects.filter(p => p.enabled !== false);
    if (options.projectFilter) {
        projects = projects.filter(p => p.id === options.projectFilter);
    }
    if (projects.length === 0) {
        throw new Error("No projects selected. Check manifest or --project filter.");
    }

    const projectResults: ProjectSmokeResult[] = [];
    for (const project of projects) {
        console.log(`\n>>> Smoke project: ${project.id}`);
        const result = await runProject(project, options);
        projectResults.push(result);
    }

    const report = aggregateReport(options, projectResults);
    ensureDir(options.outputDir);
    const reportJsonPath = path.resolve(options.outputDir, "smoke_report.json");
    const reportMdPath = path.resolve(options.outputDir, "smoke_report.md");
    fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2), "utf-8");
    fs.writeFileSync(reportMdPath, renderMarkdownReport(report), "utf-8");

    printConsoleSummary(report);
    console.log(`\nreport_json=${reportJsonPath}`);
    console.log(`report_md=${reportMdPath}`);

    if (report.fatalProjectCount > 0) {
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
