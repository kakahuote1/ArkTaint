import * as fs from "fs";
import * as path from "path";
import { OpenAICompatibleClient } from "../llm/OpenAICompatibleClient";
import { buildLlmCandidateRulesPrompt } from "../llm/prompts/llmCandidateRulesPrompt";
import { applyRuleGatingPolicy } from "../llm/RuleGating";
import { enrichNoCandidateItemsWithCallsiteSlices } from "../llm/callsiteContextSlices";
import {
    renderLlmCandidateRulesReportMarkdown,
    splitTaintRuleSetFiles,
} from "../llm/renderLlmCandidateRulesReport";
import { normalizeLlmTaintRuleSet } from "../llm/normalizeLlmRuleSet";
import { TaintRuleSet } from "../core/rules/RuleSchema";
import { validateRuleSet } from "../core/rules/RuleValidator";

declare const require: any;
declare const module: any;
declare const process: any;

interface CliOptions {
    input: string;
    output: string;
    alsoWriteTo?: string;
    enrichedDump?: string;
    /** Markdown 审查报告（含证据摘要与规则表） */
    reportMd?: string;
    /** 完整 LLM JSON（含 evidenceAck 等，便于留档/对比） */
    dumpRawLlm?: string;
    /** 按 sources/sinks/transfers（及非空时的 sanitizers）拆成多个 JSON，便于合并到 project 层 */
    splitByKind: boolean;
    model: string;
    baseUrl: string;
    apiKey?: string;
    /** Full request abort + undici body timeout (ms). */
    llmTimeoutMs: number;
    /** Undici TCP/TLS connect timeout (ms); default was 10s and caused ConnectTimeoutError. */
    llmConnectTimeoutMs: number;
    maxSources: number;
    maxSinks: number;
    maxTransfers: number;
    repo?: string;
    sourceDirs: string[];
    contextRadius: number;
    cfgNeighborRadius: number;
    maxSliceItems: number;
    examplesPerItem: number;
}

function envPositiveInt(name: string, fallback: number): number {
    const raw = typeof process.env[name] === "string" ? String(process.env[name]).trim() : "";
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function splitCsv(value?: string): string[] {
    if (!value) return [];
    return value.split(",").map(v => v.trim()).filter(Boolean);
}

/** First non-empty trimmed env among keys (order = precedence). */
function firstEnvLine(...keys: string[]): string {
    for (const k of keys) {
        const v = typeof process.env[k] === "string" ? String(process.env[k]).trim() : "";
        if (v) return v;
    }
    return "";
}

function readValue(argv: string[], i: number, prefix: string): string | undefined {
    const arg = argv[i];
    const next = i + 1 < argv.length ? argv[i + 1] : undefined;
    if (arg === prefix) return next;
    if (arg.startsWith(`${prefix}=`)) return arg.slice(prefix.length + 1);
    return undefined;
}

function parseArgs(argv: string[]): CliOptions {
    const defaultInput = path.resolve("tmp/latest_run/feedback/rule_feedback/no_candidate_callsites.json");
    const defaultOutput = path.resolve("tmp/rules/candidate.rules.json");
    const defaultAlsoWriteTo = path.resolve("src/rules/llm/project/llm_candidate.rules.json");

    let input = defaultInput;
    let output = defaultOutput;
    let alsoWriteTo: string | undefined = defaultAlsoWriteTo;
    let enrichedDump: string | undefined;
    let reportMd: string | undefined;
    let dumpRawLlm: string | undefined;
    let splitByKind = false;
    let maxSources = 20;
    let maxSinks = 30;
    let maxTransfers = 60;
    let repo: string | undefined;
    const sourceDirs: string[] = [];
    let contextRadius = 4;
    let cfgNeighborRadius = 2;
    let maxSliceItems = 48;
    let examplesPerItem = 2;
    let llmTimeoutMs = envPositiveInt("ARKTAINT_LLM_TIMEOUT_MS", 180_000);
    let llmConnectTimeoutMs = envPositiveInt("ARKTAINT_LLM_CONNECT_TIMEOUT_MS", 120_000);

    const baseUrl = (
        firstEnvLine("ARKTAINT_LLM_BASE_URL", "LLM_API_URL", "OPENAI_BASE_URL") || "https://api.openai.com/v1"
    ).replace(/\/+$/, "");
    const apiKey =
        firstEnvLine("ARKTAINT_LLM_API_KEY", "LLM_API_KEY", "OPENAI_API_KEY") || undefined;
    const model = firstEnvLine("ARKTAINT_LLM_MODEL", "LLM_MODEL", "OPENAI_MODEL");

    for (let i = 0; i < argv.length; i++) {
        const inputArg = readValue(argv, i, "--input");
        if (inputArg !== undefined) {
            input = path.resolve(inputArg);
            if (argv[i] === "--input") i++;
            continue;
        }
        const outArg = readValue(argv, i, "--output");
        if (outArg !== undefined) {
            output = path.resolve(outArg);
            if (argv[i] === "--output") i++;
            continue;
        }
        const alsoArg = readValue(argv, i, "--alsoWriteTo");
        if (alsoArg !== undefined) {
            alsoWriteTo = alsoArg.trim() ? path.resolve(alsoArg) : undefined;
            if (argv[i] === "--alsoWriteTo") i++;
            continue;
        }
        const dumpArg =
            readValue(argv, i, "--dumpEnriched") ?? readValue(argv, i, "--dumpExtracted");
        if (dumpArg !== undefined) {
            enrichedDump = dumpArg.trim() ? path.resolve(dumpArg) : undefined;
            if (argv[i] === "--dumpEnriched" || argv[i] === "--dumpExtracted") i++;
            continue;
        }
        const reportArg = readValue(argv, i, "--reportMd");
        if (reportArg !== undefined) {
            reportMd = reportArg.trim() ? path.resolve(reportArg) : undefined;
            if (argv[i] === "--reportMd") i++;
            continue;
        }
        const rawArg = readValue(argv, i, "--dumpRawLlm");
        if (rawArg !== undefined) {
            dumpRawLlm = rawArg.trim() ? path.resolve(rawArg) : undefined;
            if (argv[i] === "--dumpRawLlm") i++;
            continue;
        }
        if (argv[i] === "--splitByKind") {
            splitByKind = true;
            continue;
        }
        const repoArg = readValue(argv, i, "--repo");
        if (repoArg !== undefined) {
            repo = path.resolve(repoArg);
            if (argv[i] === "--repo") i++;
            continue;
        }
        const sdArg = readValue(argv, i, "--sourceDir");
        if (sdArg !== undefined) {
            sourceDirs.push(...splitCsv(sdArg));
            if (argv[i] === "--sourceDir") i++;
            continue;
        }
        const cr = readValue(argv, i, "--contextRadius");
        if (cr !== undefined) {
            contextRadius = Math.floor(Number(cr));
            if (argv[i] === "--contextRadius") i++;
            continue;
        }
        const cfn = readValue(argv, i, "--cfgNeighborRadius");
        if (cfn !== undefined) {
            cfgNeighborRadius = Math.floor(Number(cfn));
            if (argv[i] === "--cfgNeighborRadius") i++;
            continue;
        }
        const msi = readValue(argv, i, "--maxSliceItems");
        if (msi !== undefined) {
            maxSliceItems = Math.floor(Number(msi));
            if (argv[i] === "--maxSliceItems") i++;
            continue;
        }
        const epi = readValue(argv, i, "--examplesPerItem");
        if (epi !== undefined) {
            examplesPerItem = Math.floor(Number(epi));
            if (argv[i] === "--examplesPerItem") i++;
            continue;
        }
        const sArg = readValue(argv, i, "--maxSources");
        if (sArg !== undefined) {
            maxSources = Math.floor(Number(sArg));
            if (argv[i] === "--maxSources") i++;
            continue;
        }
        const kArg = readValue(argv, i, "--maxSinks");
        if (kArg !== undefined) {
            maxSinks = Math.floor(Number(kArg));
            if (argv[i] === "--maxSinks") i++;
            continue;
        }
        const tArg = readValue(argv, i, "--maxTransfers");
        if (tArg !== undefined) {
            maxTransfers = Math.floor(Number(tArg));
            if (argv[i] === "--maxTransfers") i++;
            continue;
        }
        const llmTo = readValue(argv, i, "--llmTimeout");
        if (llmTo !== undefined) {
            llmTimeoutMs = Math.floor(Number(llmTo));
            if (argv[i] === "--llmTimeout") i++;
            continue;
        }
        const llmCo = readValue(argv, i, "--llmConnectTimeout");
        if (llmCo !== undefined) {
            llmConnectTimeoutMs = Math.floor(Number(llmCo));
            if (argv[i] === "--llmConnectTimeout") i++;
            continue;
        }
        if (argv[i].startsWith("--")) {
            throw new Error(`unknown option: ${argv[i]}`);
        }
    }

    if (!model) {
        throw new Error("missing model: set LLM_MODEL, OPENAI_MODEL, or ARKTAINT_LLM_MODEL");
    }
    if (!apiKey) {
        throw new Error("missing api key: set LLM_API_KEY, OPENAI_API_KEY, or ARKTAINT_LLM_API_KEY");
    }
    if (!Number.isFinite(maxSources) || maxSources <= 0) throw new Error(`invalid --maxSources: ${maxSources}`);
    if (!Number.isFinite(maxSinks) || maxSinks <= 0) throw new Error(`invalid --maxSinks: ${maxSinks}`);
    if (!Number.isFinite(maxTransfers) || maxTransfers <= 0) throw new Error(`invalid --maxTransfers: ${maxTransfers}`);
    if (!Number.isFinite(contextRadius) || contextRadius < 0) throw new Error(`invalid --contextRadius: ${contextRadius}`);
    if (!Number.isFinite(cfgNeighborRadius) || cfgNeighborRadius < 0) throw new Error(`invalid --cfgNeighborRadius: ${cfgNeighborRadius}`);
    if (!Number.isFinite(maxSliceItems) || maxSliceItems < 0) throw new Error(`invalid --maxSliceItems: ${maxSliceItems}`);
    if (!Number.isFinite(examplesPerItem) || examplesPerItem <= 0) throw new Error(`invalid --examplesPerItem: ${examplesPerItem}`);
    if (!Number.isFinite(llmTimeoutMs) || llmTimeoutMs <= 0) throw new Error(`invalid --llmTimeout: ${llmTimeoutMs}`);
    if (!Number.isFinite(llmConnectTimeoutMs) || llmConnectTimeoutMs <= 0) throw new Error(`invalid --llmConnectTimeout: ${llmConnectTimeoutMs}`);

    if (repo && sourceDirs.length === 0) {
        throw new Error("when using --repo, pass at least one --sourceDir (relative to repo)");
    }
    return {
        input,
        output,
        alsoWriteTo,
        enrichedDump,
        reportMd,
        dumpRawLlm,
        splitByKind,
        model,
        baseUrl,
        apiKey,
        llmTimeoutMs,
        llmConnectTimeoutMs,
        maxSources,
        maxSinks,
        maxTransfers,
        repo,
        sourceDirs,
        contextRadius,
        cfgNeighborRadius,
        maxSliceItems,
        examplesPerItem,
    };
}

function stripJsonFences(text: string): string {
    const trimmed = String(text || "").trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fenced?.[1] ? fenced[1].trim() : trimmed;
}

function parseInputFile(inputPath: string): { items: any[]; repoFromArtifact?: string; generatedAtFromArtifact?: string } {
    const raw = fs.readFileSync(inputPath, "utf-8");
    const json = JSON.parse(raw);
    let items: any[];
    if (Array.isArray(json)) {
        items = json;
    } else if (Array.isArray(json?.items)) {
        items = json.items;
    } else {
        throw new Error(`invalid input: expected JSON array or { items: [...] } at ${inputPath}`);
    }
    const repoFromArtifact =
        typeof json?.repo === "string" && json.repo.trim() ? path.resolve(json.repo.trim()) : undefined;
    const generatedAtFromArtifact = typeof json?.generatedAt === "string" ? json.generatedAt : undefined;
    return { items, repoFromArtifact, generatedAtFromArtifact };
}

function extractTaintRuleSetFromLlmJson(parsed: any): TaintRuleSet {
    if (parsed && typeof parsed === "object" && parsed.taintRuleSet && typeof parsed.taintRuleSet === "object") {
        return parsed.taintRuleSet as TaintRuleSet;
    }
    return parsed as TaintRuleSet;
}

function writeSplitRuleKindFiles(mainOutputPath: string, ruleSet: TaintRuleSet): string[] {
    const dir = path.dirname(mainOutputPath);
    const baseName = path.basename(mainOutputPath, ".json");
    const prefix = baseName.endsWith(".rules") ? baseName.slice(0, -".rules".length) : baseName;
    const splits = splitTaintRuleSetFiles(ruleSet);
    const written: string[] = [];
    const triple: [string, TaintRuleSet][] = [
        [path.join(dir, `${prefix}.sources.json`), splits.sources],
        [path.join(dir, `${prefix}.sinks.json`), splits.sinks],
        [path.join(dir, `${prefix}.transfers.json`), splits.transfers],
    ];
    for (const [p, rs] of triple) {
        fs.writeFileSync(p, JSON.stringify(rs, null, 2), "utf-8");
        written.push(p);
    }
    const sanList = splits.sanitizers.sanitizers || [];
    if (sanList.length > 0) {
        const p = path.join(dir, `${prefix}.sanitizers.json`);
        fs.writeFileSync(p, JSON.stringify(splits.sanitizers, null, 2), "utf-8");
        written.push(p);
    }
    return written;
}

function sliceEvidenceCounts(candidates: unknown[]): { withSlices: number; withError: number } {
    let withSlices = 0;
    let withError = 0;
    for (const raw of candidates) {
        const c = raw as { contextSlices?: unknown[]; contextError?: string };
        if (Array.isArray(c.contextSlices) && c.contextSlices.length > 0) withSlices++;
        if (typeof c.contextError === "string" && c.contextError.trim()) withError++;
    }
    return { withSlices, withError };
}

export interface GenerateLlmCandidateRulesOptions {
    input: string;
    output: string;
    alsoWriteTo?: string;
    enrichedDump?: string;
    reportMd?: string;
    dumpRawLlm?: string;
    splitByKind?: boolean;
    model: string;
    baseUrl: string;
    apiKey?: string;
    llmTimeoutMs?: number;
    llmConnectTimeoutMs?: number;
    maxSources: number;
    maxSinks: number;
    maxTransfers: number;
    repo?: string;
    sourceDirs?: string[];
    contextRadius?: number;
    cfgNeighborRadius?: number;
    maxSliceItems?: number;
    examplesPerItem?: number;
}

export async function generateLlmCandidateRules(options: GenerateLlmCandidateRulesOptions): Promise<{
    ruleSet: TaintRuleSet;
    outputPath: string;
    evidenceAck?: string[];
    sliceEnriched: boolean;
    reportPath?: string;
    splitPaths?: string[];
    rawLlmPath?: string;
}> {
    const { items, repoFromArtifact, generatedAtFromArtifact } = parseInputFile(options.input);
    let candidates = items;
    const repoRoot = options.repo || repoFromArtifact;
    const sourceDirs = options.sourceDirs || [];
    let sliceEnriched = false;
    if (!repoRoot && sourceDirs.length > 0) {
        // eslint-disable-next-line no-console
        console.warn("callsite slice enrichment skipped: set --repo or ensure input JSON includes \"repo\"");
    }
    if (repoRoot && sourceDirs.length > 0) {
        sliceEnriched = true;
        candidates = enrichNoCandidateItemsWithCallsiteSlices({
            repoRoot,
            sourceDirs,
            items,
            maxItems: options.maxSliceItems ?? 48,
            maxExamplesPerItem: options.examplesPerItem ?? 2,
            contextRadius: options.contextRadius ?? 4,
            cfgNeighborRadius: options.cfgNeighborRadius ?? 2,
        });
        if (options.enrichedDump) {
            fs.mkdirSync(path.dirname(options.enrichedDump), { recursive: true });
            fs.writeFileSync(
                options.enrichedDump,
                JSON.stringify({ repo: repoRoot, sourceDirs, items: candidates }, null, 2),
                "utf-8",
            );
        }
    }

    const prompt = buildLlmCandidateRulesPrompt({
        candidates,
        budget: {
            maxSources: options.maxSources,
            maxSinks: options.maxSinks,
            maxTransfers: options.maxTransfers,
        },
    });

    const llmTimeoutMs = options.llmTimeoutMs ?? envPositiveInt("ARKTAINT_LLM_TIMEOUT_MS", 180_000);
    const llmConnectTimeoutMs =
        options.llmConnectTimeoutMs ?? envPositiveInt("ARKTAINT_LLM_CONNECT_TIMEOUT_MS", 120_000);
    const client = new OpenAICompatibleClient({
        baseUrl: options.baseUrl,
        apiKey: options.apiKey,
        timeoutMs: llmTimeoutMs,
        connectTimeoutMs: llmConnectTimeoutMs,
        bodyTimeoutMs: llmTimeoutMs,
    });
    const resp = await client.complete({
        model: options.model,
        temperature: 0,
        system: prompt.system,
        user: prompt.user,
    });

    const parsed = JSON.parse(stripJsonFences(resp.text));
    if (options.dumpRawLlm) {
        fs.mkdirSync(path.dirname(options.dumpRawLlm), { recursive: true });
        fs.writeFileSync(options.dumpRawLlm, JSON.stringify(parsed, null, 2), "utf-8");
    }
    const evidenceAck = Array.isArray(parsed?.evidenceAck)
        ? parsed.evidenceAck.map((x: any) => String(x))
        : undefined;
    const rawRuleSet = extractTaintRuleSetFromLlmJson(parsed);
    const normalized = normalizeLlmTaintRuleSet(rawRuleSet as TaintRuleSet);
    const gated = applyRuleGatingPolicy(normalized);
    const validation = validateRuleSet(gated);
    if (!validation.valid) {
        throw new Error(`LLM candidate rule set invalid: ${validation.errors.join("; ")}`);
    }

    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, JSON.stringify(gated, null, 2), "utf-8");

    if (options.alsoWriteTo) {
        fs.mkdirSync(path.dirname(options.alsoWriteTo), { recursive: true });
        fs.writeFileSync(options.alsoWriteTo, JSON.stringify(gated, null, 2), "utf-8");
    }

    const { withSlices, withError } = sliceEvidenceCounts(candidates);
    let reportPath: string | undefined;
    if (options.reportMd) {
        const md = renderLlmCandidateRulesReportMarkdown({
            meta: {
                generatedAtIso: generatedAtFromArtifact || new Date().toISOString(),
                inputPath: options.input,
                outputPath: options.output,
                model: options.model,
                repoRoot: repoRoot,
                sourceDirs: sourceDirs,
                sliceEnriched,
                inputItemCount: candidates.length,
                itemsWithContextSlices: withSlices,
                itemsWithContextError: withError,
                evidenceAck,
            },
            ruleSet: gated,
            candidates,
        });
        fs.mkdirSync(path.dirname(options.reportMd), { recursive: true });
        fs.writeFileSync(options.reportMd, md, "utf-8");
        reportPath = options.reportMd;
    }

    let splitPaths: string[] | undefined;
    if (options.splitByKind) {
        splitPaths = writeSplitRuleKindFiles(options.output, gated);
    }

    return {
        ruleSet: gated,
        outputPath: options.output,
        evidenceAck,
        sliceEnriched,
        reportPath,
        splitPaths,
        rawLlmPath: options.dumpRawLlm,
    };
}

async function main(): Promise<void> {
    const o = parseArgs(process.argv.slice(2));
    const result = await generateLlmCandidateRules({
        input: o.input,
        output: o.output,
        alsoWriteTo: o.alsoWriteTo,
        enrichedDump: o.enrichedDump,
        reportMd: o.reportMd,
        dumpRawLlm: o.dumpRawLlm,
        splitByKind: o.splitByKind,
        model: o.model,
        baseUrl: o.baseUrl,
        apiKey: o.apiKey,
        llmTimeoutMs: o.llmTimeoutMs,
        llmConnectTimeoutMs: o.llmConnectTimeoutMs,
        maxSources: o.maxSources,
        maxSinks: o.maxSinks,
        maxTransfers: o.maxTransfers,
        repo: o.repo,
        sourceDirs: o.sourceDirs.length > 0 ? o.sourceDirs : undefined,
        contextRadius: o.contextRadius,
        cfgNeighborRadius: o.cfgNeighborRadius,
        maxSliceItems: o.maxSliceItems,
        examplesPerItem: o.examplesPerItem,
    });
    const summary = {
        sources: (result.ruleSet.sources || []).length,
        sinks: (result.ruleSet.sinks || []).length,
        sanitizers: (result.ruleSet.sanitizers || []).length,
        transfers: (result.ruleSet.transfers || []).length,
    };
    console.log("====== Generate LLM Candidate Rules ======");
    console.log(`input=${o.input}`);
    console.log(`output=${result.outputPath}`);
    if (o.alsoWriteTo) console.log(`alsoWriteTo=${o.alsoWriteTo}`);
    if (o.enrichedDump) console.log(`dumpEnriched|dumpExtracted=${o.enrichedDump}`);
    if (o.reportMd) console.log(`reportMd=${result.reportPath || o.reportMd}`);
    if (o.dumpRawLlm) console.log(`dumpRawLlm=${result.rawLlmPath || o.dumpRawLlm}`);
    if (o.splitByKind && result.splitPaths?.length) {
        console.log(`splitByKind_paths=${result.splitPaths.join(";")}`);
    }
    console.log(`callsite_slices_enriched=${result.sliceEnriched} cli_repo=${o.repo || ""} sourceDirs=${o.sourceDirs.join(";")}`);
    console.log(`llm_timeout_ms=${o.llmTimeoutMs} llm_connect_timeout_ms=${o.llmConnectTimeoutMs}`);
    console.log(`model=${o.model}`);
    console.log(`budget=sources<=${o.maxSources},sinks<=${o.maxSinks},transfers<=${o.maxTransfers}`);
    console.log(`counts=${JSON.stringify(summary)}`);
    if (result.evidenceAck?.length) {
        console.log(`evidenceAck_lines=${result.evidenceAck.length}`);
    }
}

if (require.main === module) {
    main().catch(err => {
        console.error(err);
        process.exitCode = 1;
    });
}
