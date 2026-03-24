import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { ArkAssignStmt } from "../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceInvokeExpr, ArkPtrInvokeExpr, ArkStaticInvokeExpr } from "../../arkanalyzer/out/src/core/base/Expr";
import { ArkParameterRef } from "../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../arkanalyzer/out/src/core/base/Local";
import { buildArkMainPlan } from "../core/entry/arkmain/ArkMainPlanner";
import { SinkRule, SourceRule, TaintRuleSet, TransferRule } from "../core/rules/RuleSchema";
import { validateRuleSet } from "../core/rules/RuleValidator";
import * as fs from "fs";
import * as path from "path";

export interface GenerateProjectRuleCliOptions {
    repo: string;
    sourceDirs: string[];
    output: string;
    maxEntries: number;
    maxSinks: number;
    maxTransfers: number;
    includePaths: string[];
    excludePaths: string[];
    enableCandidates: boolean;
}

export interface RuleScaffoldResult {
    ruleSet: TaintRuleSet;
    outputPath?: string;
    stats: {
        sourceCandidates: number;
        sinkCandidates: number;
        transferCandidates: number;
    };
}

interface SinkCandidate {
    signature: string;
    methodName: string;
    invokeKind: "instance" | "static";
    argCount: number;
    target: "base" | "result" | `arg${number}`;
    hitCount: number;
}

interface TransferCandidate {
    signature: string;
    methodName: string;
    invokeKind: "instance" | "static";
    argCount: number;
    from: "base" | "result" | `arg${number}`;
    to: "base" | "result" | `arg${number}`;
    hitCount: number;
}

interface SourceCandidateMethod {
    name: string;
    pathHint?: string;
    signature: string;
    score: number;
}

const SOURCE_PATTERN = /(taint_src|input|url|uri|path|query|param|params|msg|message|text|content|payload|token|password|pwd|phone|email|name|id|data)/i;
const SINK_HINTS = [
    "sink",
    "axios",
    "fetch",
    "request",
    "router",
    "pushurl",
    "preferences",
    "rdb",
    "relationalstore",
    "insert",
    "update",
    "query",
    "execdml",
    "execdql",
    "console",
];

function splitCsv(value?: string): string[] {
    if (!value) return [];
    return value.split(",").map(v => v.trim()).filter(Boolean);
}

function parseArgs(argv: string[]): GenerateProjectRuleCliOptions {
    let repo = "";
    let sourceDirs: string[] = [];
    let output = "src/rules/project.rules.json";
    let maxEntries = 20;
    let maxSinks = 30;
    let maxTransfers = 40;
    const includePaths: string[] = [];
    const excludePaths: string[] = [];
    let enableCandidates = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = i + 1 < argv.length ? argv[i + 1] : undefined;
        const readValue = (prefix: string): string | undefined => {
            if (arg === prefix) return next;
            if (arg.startsWith(`${prefix}=`)) return arg.slice(prefix.length + 1);
            return undefined;
        };

        const repoArg = readValue("--repo");
        if (repoArg !== undefined) {
            repo = repoArg;
            if (arg === "--repo") i++;
            continue;
        }
        const sourceDirArg = readValue("--sourceDir");
        if (sourceDirArg !== undefined) {
            sourceDirs.push(...splitCsv(sourceDirArg));
            if (arg === "--sourceDir") i++;
            continue;
        }
        const outputArg = readValue("--output");
        if (outputArg !== undefined) {
            output = outputArg;
            if (arg === "--output") i++;
            continue;
        }
        const maxEntriesArg = readValue("--maxEntries");
        if (maxEntriesArg !== undefined) {
            maxEntries = Number(maxEntriesArg);
            if (arg === "--maxEntries") i++;
            continue;
        }
        const maxSinksArg = readValue("--maxSinks");
        if (maxSinksArg !== undefined) {
            maxSinks = Number(maxSinksArg);
            if (arg === "--maxSinks") i++;
            continue;
        }
        const maxTransfersArg = readValue("--maxTransfers");
        if (maxTransfersArg !== undefined) {
            maxTransfers = Number(maxTransfersArg);
            if (arg === "--maxTransfers") i++;
            continue;
        }
        const includeArg = readValue("--include");
        if (includeArg !== undefined) {
            includePaths.push(...splitCsv(includeArg));
            if (arg === "--include") i++;
            continue;
        }
        const excludeArg = readValue("--exclude");
        if (excludeArg !== undefined) {
            excludePaths.push(...splitCsv(excludeArg));
            if (arg === "--exclude") i++;
            continue;
        }
        if (arg === "--enableCandidates") {
            enableCandidates = true;
            continue;
        }
    }

    if (!repo) throw new Error("missing required --repo <path>");
    if (!Number.isFinite(maxEntries) || maxEntries <= 0) throw new Error(`invalid --maxEntries: ${maxEntries}`);
    if (!Number.isFinite(maxSinks) || maxSinks <= 0) throw new Error(`invalid --maxSinks: ${maxSinks}`);
    if (!Number.isFinite(maxTransfers) || maxTransfers <= 0) throw new Error(`invalid --maxTransfers: ${maxTransfers}`);

    const normalizedRepo = path.isAbsolute(repo) ? repo : path.resolve(repo);
    if (!fs.existsSync(normalizedRepo)) throw new Error(`repo path not found: ${normalizedRepo}`);

    if (sourceDirs.length === 0) {
        const auto = ["entry/src/main/ets", "src/main/ets", "."];
        sourceDirs = auto.filter(rel => fs.existsSync(path.resolve(normalizedRepo, rel)));
    }
    if (sourceDirs.length === 0) throw new Error("no sourceDir found. pass --sourceDir");

    const outputPath = path.isAbsolute(output) ? output : path.resolve(output);
    return {
        repo: normalizedRepo,
        sourceDirs: sourceDirs.map(d => d.replace(/\\/g, "/")),
        output: outputPath,
        maxEntries: Math.floor(maxEntries),
        maxSinks: Math.floor(maxSinks),
        maxTransfers: Math.floor(maxTransfers),
        includePaths,
        excludePaths,
        enableCandidates,
    };
}

function sanitizeIdPart(raw: string, fallback: string): string {
    const normalized = raw.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    return normalized.length > 0 ? normalized.slice(0, 48) : fallback;
}

function normalizeLowerList(values: string[] | undefined): string[] {
    if (!values) return [];
    return values.map(v => String(v || "").trim().toLowerCase()).filter(Boolean);
}

function matchesAny(text: string, patterns: string[]): boolean {
    if (patterns.length === 0) return false;
    const lower = text.toLowerCase();
    return patterns.some(pattern => lower.includes(pattern));
}

function extractArkFileFromSignature(signature: string): string | undefined {
    const m = signature.match(/<@([^:>]+\.ets):/);
    if (m) return m[1].replace(/\\/g, "/");
    const m2 = signature.match(/@([^:>]+\.ets):/);
    if (m2) return m2[1].replace(/\\/g, "/");
    return undefined;
}

function getParameterLocalCount(method: any): number {
    const names = new Set<string>();
    const cfg = method.getCfg?.();
    if (!cfg) return 0;
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        if (!(stmt.getRightOp() instanceof ArkParameterRef)) continue;
        const leftOp = stmt.getLeftOp();
        if (leftOp instanceof Local) {
            names.add(leftOp.getName());
        }
    }
    return names.size;
}

function getSourceLikeLocalCount(method: any): number {
    const body = method.getBody?.();
    if (!body) return 0;
    let count = 0;
    for (const local of body.getLocals().values()) {
        if (SOURCE_PATTERN.test(local.getName())) count++;
    }
    return count;
}

function collectArkMainMethods(scene: Scene): any[] {
    const runtimeMethods = buildArkMainPlan(scene).orderedMethods;
    const dedup = new Map<string, any>();
    for (const method of runtimeMethods || []) {
        const signature = method?.getSignature?.()?.toString?.();
        if (!signature) continue;
        dedup.set(signature, method);
    }
    return [...dedup.values()];
}

function scoreSourceCandidate(method: any, signature: string, fromArkMain: boolean): number {
    const nameLower = String(method.getName?.() || "").toLowerCase();
    const sigLower = signature.toLowerCase();
    const paramCount = getParameterLocalCount(method);
    const sourceLikeCount = getSourceLikeLocalCount(method);

    let score = 0;
    if (fromArkMain) score += 50;
    if (sigLower.includes("/entryability/")) score += 20;
    if (sigLower.includes("/pages/")) score += 18;
    if (sigLower.includes("/viewmodel/")) score += 15;
    if (nameLower === "build") score += 18;
    if (nameLower.startsWith("on")) score += 14;
    if (nameLower === "abouttoappear") score += 12;
    if (paramCount > 0) score += 12;
    if (sourceLikeCount > 0) score += 8;
    if (SOURCE_PATTERN.test(nameLower)) score += 6;
    return score;
}

function collectSourceCandidates(
    scene: Scene,
    sourceDir: string,
    options: GenerateProjectRuleCliOptions
): SourceCandidateMethod[] {
    const includePaths = normalizeLowerList(options.includePaths);
    const excludePaths = normalizeLowerList(options.excludePaths);
    const arkMainMethods = collectArkMainMethods(scene);
    const fromArkMain = arkMainMethods.length > 0;
    const baseMethods = fromArkMain ? arkMainMethods : scene.getMethods();
    const dedup = new Map<string, SourceCandidateMethod>();

    for (const method of baseMethods) {
        if (!method?.getCfg?.() || !method?.getBody?.()) continue;
        const name = String(method.getName?.() || "");
        if (!name || name === "%dflt") continue;
        const signature = method.getSignature?.()?.toString?.()?.replace(/\\/g, "/") || "";
        if (!signature) continue;
        const pathHint = extractArkFileFromSignature(signature);
        if (!pathHint) continue;
        const text = `${signature} ${pathHint}`.toLowerCase();
        if (excludePaths.length > 0 && matchesAny(text, excludePaths)) continue;
        if (includePaths.length > 0 && !matchesAny(text, includePaths)) continue;
        dedup.set(signature, {
            name,
            pathHint,
            signature,
            score: scoreSourceCandidate(method, signature, fromArkMain),
        });
    }

    const perSourceBudget = Math.max(1, Math.floor(options.maxEntries / Math.max(1, options.sourceDirs.length)));
    return [...dedup.values()]
        .sort((a, b) => b.score - a.score || a.signature.localeCompare(b.signature))
        .slice(0, perSourceBudget)
        .map(candidate => ({
            ...candidate,
            pathHint: candidate.pathHint || sourceDir,
        }));
}

function uniqueBySignature<T extends { signature: string; hitCount: number }>(items: T[]): T[] {
    const map = new Map<string, T>();
    for (const item of items) {
        const existing = map.get(item.signature);
        if (!existing || item.hitCount > existing.hitCount) {
            map.set(item.signature, item);
        }
    }
    return Array.from(map.values());
}

function resolveInvokeMethodName(signature: string): string {
    const m = signature.match(/\.([A-Za-z0-9_$]+)\(/);
    return m ? m[1] : "";
}

function isSinkLike(signature: string, methodName: string): boolean {
    const text = `${signature} ${methodName}`.toLowerCase();
    return SINK_HINTS.some(x => text.includes(x));
}

function resolveSinkSeverity(signature: string, methodName: string): "low" | "medium" | "high" {
    const text = `${signature} ${methodName}`.toLowerCase();
    if (text.includes("insert") || text.includes("update") || text.includes("delete") || text.includes("execdml") || text.includes("execdql")) {
        return "high";
    }
    if (text.includes("fetch") || text.includes("axios") || text.includes("request") || text.includes("router")) {
        return "medium";
    }
    return "low";
}

function pickSinkTarget(invokeKind: "instance" | "static", argCount: number): "base" | "result" | `arg${number}` {
    if (argCount > 0) return "arg0";
    if (invokeKind === "instance") return "base";
    return "result";
}

function collectCandidatesFromScene(
    scene: Scene,
    sourceDir: string,
    options: GenerateProjectRuleCliOptions,
    sourceRules: SourceRule[],
    sinkCandidates: Map<string, SinkCandidate>,
    transferCandidates: Map<string, TransferCandidate>
): void {
    const sourceCandidates = collectSourceCandidates(scene, sourceDir, options);

    for (const candidate of sourceCandidates) {
        const idPart = sanitizeIdPart(`${candidate.name}_${candidate.pathHint || sourceDir}`, "entry");
        const sourceRule: SourceRule = {
            id: `source.candidate.${idPart}`,
            enabled: options.enableCandidates,
            description: "[candidate] auto-discovered entry_param; requires manual review of the target parameter slot.",
            tags: ["candidate", "auto", "source", "entry_param"],
            sourceKind: "entry_param",
            match: {
                kind: "method_name_equals",
                value: candidate.name,
            },
            scope: candidate.pathHint ? {
                file: {
                    mode: "contains",
                    value: candidate.pathHint,
                },
            } : undefined,
            target: "arg0",
        };
        sourceRules.push(sourceRule);
    }

    for (const method of scene.getMethods()) {
        const cfg = method.getCfg();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!invokeExpr) continue;
            if (!(invokeExpr instanceof ArkInstanceInvokeExpr) && !(invokeExpr instanceof ArkStaticInvokeExpr) && !(invokeExpr instanceof ArkPtrInvokeExpr)) {
                continue;
            }

            const signature = invokeExpr.getMethodSignature?.()?.toString?.() || "";
            if (!signature) continue;
            const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            const argCount = args.length;
            const invokeKind: "instance" | "static" =
                (invokeExpr instanceof ArkInstanceInvokeExpr || invokeExpr instanceof ArkPtrInvokeExpr) ? "instance" : "static";
            const methodName = resolveInvokeMethodName(signature) || "unknown";

            if (isSinkLike(signature, methodName)) {
                const sinkKey = `${signature}|${invokeKind}|${argCount}`;
                const current = sinkCandidates.get(sinkKey);
                if (current) {
                    current.hitCount += 1;
                } else {
                    sinkCandidates.set(sinkKey, {
                        signature,
                        methodName,
                        invokeKind,
                        argCount,
                        target: pickSinkTarget(invokeKind, argCount),
                        hitCount: 1,
                    });
                }
            }

            const hasResult = stmt instanceof ArkAssignStmt;
            if (invokeKind === "instance" && argCount > 0) {
                const key = `${signature}|arg0->base|${invokeKind}|${argCount}`;
                const current = transferCandidates.get(key);
                if (current) {
                    current.hitCount += 1;
                } else {
                    transferCandidates.set(key, {
                        signature,
                        methodName,
                        invokeKind,
                        argCount,
                        from: "arg0",
                        to: "base",
                        hitCount: 1,
                    });
                }
            }
            if (hasResult && argCount > 0) {
                const key = `${signature}|arg0->result|${invokeKind}|${argCount}`;
                const current = transferCandidates.get(key);
                if (current) {
                    current.hitCount += 1;
                } else {
                    transferCandidates.set(key, {
                        signature,
                        methodName,
                        invokeKind,
                        argCount,
                        from: "arg0",
                        to: "result",
                        hitCount: 1,
                    });
                }
            }
            if (hasResult && invokeKind === "instance") {
                const key = `${signature}|base->result|${invokeKind}|${argCount}`;
                const current = transferCandidates.get(key);
                if (current) {
                    current.hitCount += 1;
                } else {
                    transferCandidates.set(key, {
                        signature,
                        methodName,
                        invokeKind,
                        argCount,
                        from: "base",
                        to: "result",
                        hitCount: 1,
                    });
                }
            }
        }
    }
}

function buildRuleSetFromCandidates(
    repo: string,
    enableCandidates: boolean,
    sourceRules: SourceRule[],
    sinkCandidates: SinkCandidate[],
    transferCandidates: TransferCandidate[]
): TaintRuleSet {
    const uniqueSources = Array.from(new Map(sourceRules.map(r => [r.id, r])).values());
    const uniqueSinks = uniqueBySignature(sinkCandidates)
        .sort((a, b) => b.hitCount - a.hitCount || a.signature.localeCompare(b.signature))
        .map((c, idx): SinkRule => ({
            id: `sink.candidate.${sanitizeIdPart(c.methodName, "sink")}.${idx + 1}`,
            enabled: enableCandidates,
            description: `[候选] 自动发现 sink 调用，命中次�?${c.hitCount}，需人工确认位点。`,
            tags: ["candidate", "auto", "sink"],
            severity: resolveSinkSeverity(c.signature, c.methodName),
            category: "auto_discovered",
            match: {
                kind: "signature_equals",
                value: c.signature,
                invokeKind: c.invokeKind,
                argCount: c.argCount,
            },
            target: c.target,
        }));

    const transfers = transferCandidates
        .sort((a, b) => b.hitCount - a.hitCount || a.signature.localeCompare(b.signature))
        .map((c, idx): TransferRule => ({
            id: `transfer.candidate.${sanitizeIdPart(c.methodName, "transfer")}.${idx + 1}`,
            enabled: enableCandidates,
            description: `[候选] 自动发现 transfer ${c.from}->${c.to}，命中次�?${c.hitCount}，需人工确认。`,
            tags: ["candidate", "auto", "transfer"],
            match: {
                kind: "signature_equals",
                value: c.signature,
                invokeKind: c.invokeKind,
                argCount: c.argCount,
            },
            from: c.from,
            to: c.to,
        }));

    return {
        schemaVersion: "2.0",
        meta: {
            name: "arktaint-project-rules-scaffold",
            description: `Auto generated project rule scaffold for ${repo}. Candidates are disabled by default.`,
            updatedAt: new Date().toISOString().slice(0, 10),
        },
        sources: uniqueSources,
        sinks: uniqueSinks,
        transfers,
    };
}

export function generateProjectRuleScaffold(options: GenerateProjectRuleCliOptions): RuleScaffoldResult {
    const sourceRules: SourceRule[] = [];
    const sinkCandidates = new Map<string, SinkCandidate>();
    const transferCandidates = new Map<string, TransferCandidate>();

    for (const sourceDir of options.sourceDirs) {
        const sourceAbs = path.resolve(options.repo, sourceDir);
        if (!fs.existsSync(sourceAbs)) continue;
        const config = new SceneConfig();
        config.buildFromProjectDir(sourceAbs);
        const scene = new Scene();
        scene.buildSceneFromProjectDir(config);
        scene.inferTypes();
        collectCandidatesFromScene(scene, sourceDir, options, sourceRules, sinkCandidates, transferCandidates);
    }

    const sinkList = Array.from(sinkCandidates.values()).slice(0, options.maxSinks);
    const transferList = Array.from(transferCandidates.values()).slice(0, options.maxTransfers);
    const sourceList = sourceRules.slice(0, options.maxEntries);

    const ruleSet = buildRuleSetFromCandidates(
        options.repo,
        options.enableCandidates,
        sourceList,
        sinkList,
        transferList
    );
    const validation = validateRuleSet(ruleSet);
    if (!validation.valid) {
        throw new Error(`Generated rule scaffold invalid: ${validation.errors.join("; ")}`);
    }

    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, JSON.stringify(ruleSet, null, 2), "utf-8");

    return {
        ruleSet,
        outputPath: options.output,
        stats: {
            sourceCandidates: (ruleSet.sources || []).length,
            sinkCandidates: (ruleSet.sinks || []).length,
            transferCandidates: (ruleSet.transfers || []).length,
        },
    };
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const result = generateProjectRuleScaffold(options);
    console.log("====== Generate Project Rules Scaffold ======");
    console.log(`repo=${options.repo}`);
    console.log(`source_dirs=${options.sourceDirs.join(",")}`);
    console.log(`output=${result.outputPath}`);
    console.log(`source_candidates=${result.stats.sourceCandidates}`);
    console.log(`sink_candidates=${result.stats.sinkCandidates}`);
    console.log(`transfer_candidates=${result.stats.transferCandidates}`);
    console.log(`candidates_enabled=${options.enableCandidates}`);
    console.log("next_step=edit_rules_and_set_enabled_true_for_confirmed_candidates");
}

if (require.main === module) {
    main().catch(err => {
        console.error(err);
        process.exitCode = 1;
    });
}
