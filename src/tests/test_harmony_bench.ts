import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../core/orchestration/TaintPropagationEngine";
import { LoadedRuleSet, loadRuleSet } from "../core/rules/RuleLoader";
import { TaintFlow } from "../core/kernel/TaintFlow";
import * as fs from "fs";
import * as path from "path";
import { registerMockSdkFiles } from "./helpers/TestSceneBuilder";

interface HarmonyBenchCase {
    case_id: string;
    file: string;
    entry: string;
    expected_flow: boolean;
    expected_sink_pattern: string;
    scored: boolean;
    limitation_note?: string;
    expected_flow_count_min?: number;
    expected_flow_count_max?: number;
}

interface HarmonyBenchRulePaths {
    default: string;
    framework: string;
    project: string;
}

interface HarmonyBenchCategory {
    id: string;
    name: string;
    supported: boolean;
    sourceDir: string;
    rules: HarmonyBenchRulePaths;
    cases: HarmonyBenchCase[];
}

interface HarmonyBenchManifest {
    name: string;
    version: string;
    description?: string;
    categories: HarmonyBenchCategory[];
}

interface CliOptions {
    manifestPath: string;
    k: number;
    outputDir: string;
}

type CaseClassification = "TP" | "FP" | "TN" | "FN";

interface CaseRunResult {
    categoryId: string;
    categoryName: string;
    supported: boolean;
    caseId: string;
    file: string;
    entry: string;
    scored: boolean;
    expectedFlow: boolean;
    expectedSinkPattern: string;
    limitationNote?: string;
    expectedFlowCountMin?: number;
    expectedFlowCountMax?: number;
    seedCount: number;
    flowCount: number;
    matchedFlowCount: number;
    detectedAny: boolean;
    detectedByPattern: boolean;
    pass: boolean;
    classification: CaseClassification;
    sinkSamples: string[];
    elapsedMs: number;
    error?: string;
}

interface CategorySummary {
    id: string;
    name: string;
    supported: boolean;
    cases: number;
    scoredCases: number;
    tp: number;
    fp: number;
    tn: number;
    fn: number;
    recall: number | null;
    precision: number | null;
    runtimeMs: number;
}

interface UnexpectedHitItem {
    categoryId: string;
    caseId: string;
    file: string;
    expectedFlow: boolean;
    matchedFlowCount: number;
    flowCount: number;
    sinkPattern: string;
    sinkSamples: string[];
}

interface BenchmarkReport {
    generatedAt: string;
    manifestPath: string;
    k: number;
    categoryCount: number;
    caseCount: number;
    categories: CategorySummary[];
    supported_metrics: {
        cases: number;
        tp: number;
        fp: number;
        tn: number;
        fn: number;
        recall: number | null;
        precision: number | null;
    };
    unsupported_observations: Array<{
        categoryId: string;
        categoryName: string;
        scoredCases: number;
        tp_obs: number;
        fp_obs: number;
        tn_obs: number;
        fn_obs: number;
    }>;
    unsupported_fn_notes: Array<{
        categoryId: string;
        categoryName: string;
        caseId: string;
        file: string;
        limitationNote: string;
    }>;
    unexpected_hits: UnexpectedHitItem[];
    failures: CaseRunResult[];
}

function parseArgs(argv: string[]): CliOptions {
    let manifestPath = "tests/benchmark/HarmonyBench/manifest.json";
    let k = 1;
    let outputDir = "tmp/harmony_bench";

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
        if (arg === "--outputDir" && i + 1 < argv.length) {
            outputDir = argv[++i];
            continue;
        }
        if (arg.startsWith("--outputDir=")) {
            outputDir = arg.slice("--outputDir=".length);
            continue;
        }
    }

    if (k !== 0 && k !== 1) {
        throw new Error(`Invalid --k value: ${k}. Expected 0 or 1.`);
    }

    return {
        manifestPath: path.resolve(manifestPath),
        k,
        outputDir: path.resolve(outputDir),
    };
}

function asObject(value: unknown, label: string): Record<string, any> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Invalid ${label}: expected object`);
    }
    return value as Record<string, any>;
}

function assertCaseFileSuffix(caseInfo: HarmonyBenchCase): void {
    const file = caseInfo.file;
    if (file.endsWith("_T.ets") && caseInfo.expected_flow !== true) {
        throw new Error(`Manifest mismatch: ${file} ends with _T.ets but expected_flow=false`);
    }
    if (file.endsWith("_F.ets") && caseInfo.expected_flow !== false) {
        throw new Error(`Manifest mismatch: ${file} ends with _F.ets but expected_flow=true`);
    }
}

function readManifest(manifestPath: string): HarmonyBenchManifest {
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`Manifest file not found: ${manifestPath}`);
    }
    const rawText = fs.readFileSync(manifestPath, "utf-8").replace(/^\uFEFF/, "");
    const raw = JSON.parse(rawText) as unknown;
    const root = asObject(raw, "manifest");
    if (!Array.isArray(root.categories) || root.categories.length === 0) {
        throw new Error("Invalid manifest: categories[] is required");
    }

    const categories: HarmonyBenchCategory[] = [];
    for (const [idx, categoryRaw] of root.categories.entries()) {
        const cObj = asObject(categoryRaw, `categories[${idx}]`);
        const id = String(cObj.id || "").trim();
        const name = String(cObj.name || "").trim();
        const sourceDir = String(cObj.sourceDir || "").trim();
        if (!id || !name || !sourceDir) {
            throw new Error(`Invalid categories[${idx}]: id/name/sourceDir are required`);
        }
        if (typeof cObj.supported !== "boolean") {
            throw new Error(`Invalid categories[${idx}]: supported must be boolean`);
        }
        const rulesObj = asObject(cObj.rules, `categories[${idx}].rules`);
        const rules: HarmonyBenchRulePaths = {
            default: String(rulesObj.default || "").trim(),
            framework: String(rulesObj.framework || "").trim(),
            project: String(rulesObj.project || "").trim(),
        };
        if (!rules.default || !rules.framework || !rules.project) {
            throw new Error(`Invalid categories[${idx}].rules: default/framework/project are required`);
        }
        if (!Array.isArray(cObj.cases) || cObj.cases.length === 0) {
            throw new Error(`Invalid categories[${idx}]: cases[] is required`);
        }

        const cases: HarmonyBenchCase[] = [];
        for (const [caseIdx, caseRaw] of cObj.cases.entries()) {
            const caseObj = asObject(caseRaw, `categories[${idx}].cases[${caseIdx}]`);
            const caseInfo: HarmonyBenchCase = {
                case_id: String(caseObj.case_id || "").trim(),
                file: String(caseObj.file || "").trim(),
                entry: String(caseObj.entry || "").trim(),
                expected_flow: Boolean(caseObj.expected_flow),
                expected_sink_pattern: String(caseObj.expected_sink_pattern || "").trim(),
                scored: Boolean(caseObj.scored),
                limitation_note: caseObj.limitation_note !== undefined
                    ? String(caseObj.limitation_note || "").trim()
                    : undefined,
                expected_flow_count_min: caseObj.expected_flow_count_min !== undefined
                    ? Number(caseObj.expected_flow_count_min)
                    : undefined,
                expected_flow_count_max: caseObj.expected_flow_count_max !== undefined
                    ? Number(caseObj.expected_flow_count_max)
                    : undefined,
            };
            if (!caseInfo.case_id || !caseInfo.file || !caseInfo.entry || !caseInfo.expected_sink_pattern) {
                throw new Error(`Invalid categories[${idx}].cases[${caseIdx}]: case_id/file/entry/expected_sink_pattern are required`);
            }
            if (caseInfo.expected_flow_count_min !== undefined && !Number.isFinite(caseInfo.expected_flow_count_min)) {
                throw new Error(`Invalid expected_flow_count_min in ${caseInfo.case_id}`);
            }
            if (caseInfo.expected_flow_count_max !== undefined && !Number.isFinite(caseInfo.expected_flow_count_max)) {
                throw new Error(`Invalid expected_flow_count_max in ${caseInfo.case_id}`);
            }
            if (
                caseInfo.expected_flow_count_min !== undefined
                && caseInfo.expected_flow_count_max !== undefined
                && caseInfo.expected_flow_count_min > caseInfo.expected_flow_count_max
            ) {
                throw new Error(`Invalid flow range in ${caseInfo.case_id}: min > max`);
            }
            if (!cObj.supported && caseInfo.scored && caseInfo.expected_flow && !caseInfo.limitation_note) {
                throw new Error(`Invalid ${caseInfo.case_id}: limitation_note is required for unsupported scored _T cases`);
            }
            assertCaseFileSuffix(caseInfo);
            cases.push(caseInfo);
        }

        categories.push({
            id,
            name,
            supported: cObj.supported as boolean,
            sourceDir,
            rules,
            cases,
        });
    }

    return {
        name: String(root.name || "HarmonyBench"),
        version: String(root.version || "1.0.0"),
        description: root.description ? String(root.description) : undefined,
        categories,
    };
}

function ensureRequiredPaths(manifestPath: string, manifest: HarmonyBenchManifest): void {
    for (const category of manifest.categories) {
        const sourceDirAbs = path.resolve(process.cwd(), category.sourceDir);
        if (!fs.existsSync(sourceDirAbs)) {
            throw new Error(`sourceDir not found for ${category.id}: ${sourceDirAbs}`);
        }
        const defaultAbs = path.resolve(process.cwd(), category.rules.default);
        const frameworkAbs = path.resolve(process.cwd(), category.rules.framework);
        const projectAbs = path.resolve(process.cwd(), category.rules.project);
        for (const p of [defaultAbs, frameworkAbs, projectAbs]) {
            if (!fs.existsSync(p)) {
                throw new Error(`Rule file not found for ${category.id}: ${p}`);
            }
        }
        for (const c of category.cases) {
            const caseAbs = path.resolve(sourceDirAbs, c.file);
            if (!fs.existsSync(caseAbs)) {
                throw new Error(`Case file not found for ${category.id}/${c.case_id}: ${caseAbs}`);
            }
        }
    }
}

function buildScene(sourceDirAbs: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(sourceDirAbs);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    registerMockSdkFiles(scene);
    return scene;
}

function matchesSinkPattern(stmtText: string, pattern: string): boolean {
    const trimmed = pattern.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith("/") && trimmed.endsWith("/") && trimmed.length > 2) {
        const regexBody = trimmed.slice(1, -1);
        return new RegExp(regexBody).test(stmtText);
    }
    return stmtText.includes(trimmed);
}

function inExpectedFlowRange(caseInfo: HarmonyBenchCase, matchedFlowCount: number): boolean {
    if (caseInfo.expected_flow_count_min !== undefined && matchedFlowCount < caseInfo.expected_flow_count_min) {
        return false;
    }
    if (caseInfo.expected_flow_count_max !== undefined && matchedFlowCount > caseInfo.expected_flow_count_max) {
        return false;
    }
    return true;
}

function classifyCase(expectedFlow: boolean, detectedByPattern: boolean, detectedAny: boolean): CaseClassification {
    if (expectedFlow) return detectedByPattern ? "TP" : "FN";
    return detectedAny ? "FP" : "TN";
}

function calcRecall(tp: number, fn: number): number | null {
    const denom = tp + fn;
    if (denom === 0) return null;
    return tp / denom;
}

function calcPrecision(tp: number, fp: number): number | null {
    const denom = tp + fp;
    if (denom === 0) return null;
    return tp / denom;
}

function fmtPercent(value: number | null): string {
    if (value === null) return "N/A";
    return `${(value * 100).toFixed(1)}%`;
}

function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

function renderMarkdownReport(report: BenchmarkReport): string {
    const lines: string[] = [];
    lines.push("# HarmonyBench Report");
    lines.push("");
    lines.push(`- generatedAt: ${report.generatedAt}`);
    lines.push(`- manifest: ${report.manifestPath}`);
    lines.push(`- k: ${report.k}`);
    lines.push(`- categories: ${report.categoryCount}`);
    lines.push(`- cases: ${report.caseCount}`);
    lines.push("");
    lines.push("| Category | Supported | Cases | TP | FP | TN | FN | Recall | Precision |");
    lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const c of report.categories) {
        lines.push(`| ${c.id} | ${c.supported ? "Y" : "N"} | ${c.scoredCases} | ${c.tp} | ${c.fp} | ${c.tn} | ${c.fn} | ${fmtPercent(c.recall)} | ${fmtPercent(c.precision)} |`);
    }
    const s = report.supported_metrics;
    lines.push(`| Supported Total | Y | ${s.cases} | ${s.tp} | ${s.fp} | ${s.tn} | ${s.fn} | ${fmtPercent(s.recall)} | ${fmtPercent(s.precision)} |`);
    lines.push("");

    if (report.unexpected_hits.length > 0) {
        lines.push("## Unexpected Hits");
        lines.push("");
        for (const hit of report.unexpected_hits) {
            lines.push(`- [${hit.categoryId}] ${hit.caseId} (${hit.file}) flowCount=${hit.flowCount} matched=${hit.matchedFlowCount} expectedFlow=${hit.expectedFlow}`);
            for (const sample of hit.sinkSamples) {
                lines.push(`  - ${sample}`);
            }
        }
        lines.push("");
    }

    if (report.unsupported_fn_notes.length > 0) {
        lines.push("## Unsupported FN Limitation Notes");
        lines.push("");
        for (const note of report.unsupported_fn_notes) {
            lines.push(`- [${note.categoryId}] ${note.caseId} (${note.file}): ${note.limitationNote}`);
        }
        lines.push("");
    }

    if (report.failures.length > 0) {
        lines.push("## Supported Failures");
        lines.push("");
        for (const f of report.failures) {
            lines.push(`- [${f.categoryId}] ${f.caseId} expected=${f.expectedFlow ? "T" : "F"} detected=${f.detectedByPattern} flowCount=${f.flowCount} matched=${f.matchedFlowCount}`);
        }
        lines.push("");
    }

    return lines.join("\n");
}

async function runCase(
    scene: Scene,
    category: HarmonyBenchCategory,
    caseInfo: HarmonyBenchCase,
    k: number,
    loadedRules: LoadedRuleSet
): Promise<CaseRunResult> {
    const start = Date.now();
    try {
        const engine = new TaintPropagationEngine(scene, k, {
            transferRules: loadedRules.ruleSet.transfers || [],
        });
        engine.verbose = false;
        await engine.buildPAG();
        try {
            const reachable = engine.computeReachableMethodSignatures();
            engine.setActiveReachableMethodSignatures(reachable);
        } catch {
            engine.setActiveReachableMethodSignatures(undefined);
        }

        const seedInfo = engine.propagateWithSourceRules(loadedRules.ruleSet.sources || []);
        const flows = engine.detectSinksByRules(loadedRules.ruleSet.sinks || [], {
            sanitizerRules: loadedRules.ruleSet.sanitizers || [],
        });
        const matchedFlows = flows.filter(flow => matchesSinkPattern(flow.sink.toString(), caseInfo.expected_sink_pattern));
        const detectedByPattern = matchedFlows.length > 0;
        const detectedAny = flows.length > 0;
        const rangeOk = inExpectedFlowRange(caseInfo, matchedFlows.length);
        const classification = classifyCase(caseInfo.expected_flow, detectedByPattern, detectedAny);
        const pass = caseInfo.expected_flow
            ? detectedByPattern && rangeOk
            : !detectedAny;

        return {
            categoryId: category.id,
            categoryName: category.name,
            supported: category.supported,
            caseId: caseInfo.case_id,
            file: caseInfo.file,
            entry: caseInfo.entry,
            scored: caseInfo.scored,
            expectedFlow: caseInfo.expected_flow,
            expectedSinkPattern: caseInfo.expected_sink_pattern,
            limitationNote: caseInfo.limitation_note,
            expectedFlowCountMin: caseInfo.expected_flow_count_min,
            expectedFlowCountMax: caseInfo.expected_flow_count_max,
            seedCount: seedInfo.seedCount,
            flowCount: flows.length,
            matchedFlowCount: matchedFlows.length,
            detectedAny,
            detectedByPattern,
            pass,
            classification,
            sinkSamples: flows.slice(0, 3).map((f: TaintFlow) => f.sink.toString()),
            elapsedMs: Date.now() - start,
        };
    } catch (err: any) {
        return {
            categoryId: category.id,
            categoryName: category.name,
            supported: category.supported,
            caseId: caseInfo.case_id,
            file: caseInfo.file,
            entry: caseInfo.entry,
            scored: caseInfo.scored,
            expectedFlow: caseInfo.expected_flow,
            expectedSinkPattern: caseInfo.expected_sink_pattern,
            limitationNote: caseInfo.limitation_note,
            expectedFlowCountMin: caseInfo.expected_flow_count_min,
            expectedFlowCountMax: caseInfo.expected_flow_count_max,
            seedCount: 0,
            flowCount: 0,
            matchedFlowCount: 0,
            detectedAny: false,
            detectedByPattern: false,
            pass: false,
            classification: caseInfo.expected_flow ? "FN" : "FP",
            sinkSamples: [],
            elapsedMs: Date.now() - start,
            error: String(err?.message || err),
        };
    }
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const manifest = readManifest(options.manifestPath);
    ensureRequiredPaths(options.manifestPath, manifest);

    const sceneCache = new Map<string, Scene>();
    const caseResults: CaseRunResult[] = [];
    const categorySummaries: CategorySummary[] = [];
    const unexpectedHits: UnexpectedHitItem[] = [];
    const failures: CaseRunResult[] = [];
    const unsupportedFnNotes: Array<{
        categoryId: string;
        categoryName: string;
        caseId: string;
        file: string;
        limitationNote: string;
    }> = [];

    for (const category of manifest.categories) {
        const sourceDirAbs = path.resolve(process.cwd(), category.sourceDir);
        const defaultRulePath = path.resolve(process.cwd(), category.rules.default);
        const frameworkRulePath = path.resolve(process.cwd(), category.rules.framework);
        const projectRulePath = path.resolve(process.cwd(), category.rules.project);

        let scene = sceneCache.get(sourceDirAbs);
        if (!scene) {
            scene = buildScene(sourceDirAbs);
            sceneCache.set(sourceDirAbs, scene);
        }

        const loadedRules = loadRuleSet({
            defaultRulePath,
            frameworkRulePath,
            projectRulePath,
            autoDiscoverLayers: false,
            allowMissingFramework: false,
            allowMissingProject: false,
            allowMissingLlmCandidate: true,
        });

        const catStart = Date.now();
        const categoryResults: CaseRunResult[] = [];
        for (const caseInfo of category.cases) {
            const result = await runCase(scene, category, caseInfo, options.k, loadedRules);
            categoryResults.push(result);
            caseResults.push(result);

            if (!category.supported && result.scored && result.detectedAny) {
                unexpectedHits.push({
                    categoryId: result.categoryId,
                    caseId: result.caseId,
                    file: result.file,
                    expectedFlow: result.expectedFlow,
                    matchedFlowCount: result.matchedFlowCount,
                    flowCount: result.flowCount,
                    sinkPattern: result.expectedSinkPattern,
                    sinkSamples: result.sinkSamples,
                });
                console.warn(`[UNEXPECTED_HIT] ${result.categoryId}/${result.caseId} detected flow(s) in unsupported category.`);
            }
            if (
                !category.supported
                && result.scored
                && result.classification === "FN"
                && result.limitationNote
            ) {
                unsupportedFnNotes.push({
                    categoryId: result.categoryId,
                    categoryName: result.categoryName,
                    caseId: result.caseId,
                    file: result.file,
                    limitationNote: result.limitationNote,
                });
            }
            if (category.supported && result.scored && !result.pass) {
                failures.push(result);
            }
        }

        const scored = categoryResults.filter(r => r.scored);
        const tp = scored.filter(r => r.classification === "TP").length;
        const fp = scored.filter(r => r.classification === "FP").length;
        const tn = scored.filter(r => r.classification === "TN").length;
        const fn = scored.filter(r => r.classification === "FN").length;
        categorySummaries.push({
            id: category.id,
            name: category.name,
            supported: category.supported,
            cases: categoryResults.length,
            scoredCases: scored.length,
            tp,
            fp,
            tn,
            fn,
            recall: category.supported ? calcRecall(tp, fn) : null,
            precision: category.supported ? calcPrecision(tp, fp) : null,
            runtimeMs: Date.now() - catStart,
        });
    }

    const supportedCategories = categorySummaries.filter(c => c.supported);
    const supportedMetrics = {
        cases: supportedCategories.reduce((sum, c) => sum + c.scoredCases, 0),
        tp: supportedCategories.reduce((sum, c) => sum + c.tp, 0),
        fp: supportedCategories.reduce((sum, c) => sum + c.fp, 0),
        tn: supportedCategories.reduce((sum, c) => sum + c.tn, 0),
        fn: supportedCategories.reduce((sum, c) => sum + c.fn, 0),
        recall: calcRecall(
            supportedCategories.reduce((sum, c) => sum + c.tp, 0),
            supportedCategories.reduce((sum, c) => sum + c.fn, 0)
        ),
        precision: calcPrecision(
            supportedCategories.reduce((sum, c) => sum + c.tp, 0),
            supportedCategories.reduce((sum, c) => sum + c.fp, 0)
        ),
    };

    const unsupportedObservations = categorySummaries
        .filter(c => !c.supported)
        .map(c => ({
            categoryId: c.id,
            categoryName: c.name,
            scoredCases: c.scoredCases,
            tp_obs: c.tp,
            fp_obs: c.fp,
            tn_obs: c.tn,
            fn_obs: c.fn,
        }));

    const report: BenchmarkReport = {
        generatedAt: new Date().toISOString(),
        manifestPath: options.manifestPath,
        k: options.k,
        categoryCount: categorySummaries.length,
        caseCount: caseResults.length,
        categories: categorySummaries,
        supported_metrics: supportedMetrics,
        unsupported_observations: unsupportedObservations,
        unsupported_fn_notes: unsupportedFnNotes,
        unexpected_hits: unexpectedHits,
        failures,
    };

    ensureDir(options.outputDir);
    const reportJsonPath = path.resolve(options.outputDir, "report.json");
    const reportMdPath = path.resolve(options.outputDir, "report.md");
    fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2), "utf-8");
    fs.writeFileSync(reportMdPath, renderMarkdownReport(report), "utf-8");

    console.log("====== HarmonyBench Summary ======");
    console.log(`manifest=${options.manifestPath}`);
    console.log(`k=${options.k}`);
    console.log(`categories=${report.categoryCount}`);
    console.log(`cases=${report.caseCount}`);
    console.log(`supported_tp=${supportedMetrics.tp}`);
    console.log(`supported_fp=${supportedMetrics.fp}`);
    console.log(`supported_tn=${supportedMetrics.tn}`);
    console.log(`supported_fn=${supportedMetrics.fn}`);
    console.log(`supported_recall=${fmtPercent(supportedMetrics.recall)}`);
    console.log(`supported_precision=${fmtPercent(supportedMetrics.precision)}`);
    console.log(`unsupported_unexpected_hits=${unexpectedHits.length}`);
    console.log(`report_json=${reportJsonPath}`);
    console.log(`report_md=${reportMdPath}`);

    if (failures.length > 0) {
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});

