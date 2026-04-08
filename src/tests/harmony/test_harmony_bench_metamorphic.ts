import { Scene } from "../../../arkanalyzer/lib/Scene";
import { SceneConfig } from "../../../arkanalyzer/lib/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { LoadedRuleSet, loadRuleSet } from "../../core/rules/RuleLoader";
import { TaintFlow } from "../../core/kernel/model/TaintFlow";
import {
    HarmonyBenchCase,
    HarmonyMutatedCase,
    HarmonyMutatorGroup,
    generateHarmonyMutationDataset,
} from "../../tools/metamorphic/HarmonyMetamorphicGenerator";
import * as fs from "fs";
import * as path from "path";
import { registerMockSdkFiles } from "../helpers/TestSceneBuilder";
import { resolveExpectedSinkRuleIds, summarizeSinkInventoryFlows } from "../helpers/SinkInventoryScoring";

interface CliOptions {
    manifestPath: string;
    outputDir: string;
    docsPath: string;
    k: number;
    groups: HarmonyMutatorGroup[];
    maxCasesPerCategory: number;
    categoryRegex: RegExp;
    semanticAnchorHintsPath?: string;
}

interface AnalyzeResult {
    ok: boolean;
    expectedFlow: boolean;
    detectedAny: boolean;
    detectedTarget: boolean;
    flowCount: number;
    targetFlowCount: number;
    spilloverFlowCount: number;
    classification: "TP" | "FP" | "TN" | "FN";
    pass: boolean;
    sinkSamples: string[];
    sinkRuleHits: Record<string, number>;
    sinkFamilyHits: Record<string, number>;
    sinkEndpointHits: Record<string, number>;
    elapsedMs: number;
    seedCount: number;
    ruleHits: {
        source: Record<string, number>;
        sink: Record<string, number>;
        transfer: Record<string, number>;
    };
    error?: string;
}

interface AConsistencyItem {
    group: "A";
    transform: string;
    categoryId: string;
    caseId: string;
    file: string;
    baselineDetected: boolean;
    mutatedDetected: boolean;
    baselineClassification: string;
    mutatedClassification: string;
    consistent: boolean;
    baselineRuleHits: {
        source: Record<string, number>;
        sink: Record<string, number>;
        transfer: Record<string, number>;
    };
    mutatedRuleHits: {
        source: Record<string, number>;
        sink: Record<string, number>;
        transfer: Record<string, number>;
    };
}

interface BChallengeItem {
    group: "B";
    transform: string;
    categoryId: string;
    caseId: string;
    file: string;
    expectedFlow: boolean;
    classification: "TP" | "FP" | "TN" | "FN";
    detectedTarget: boolean;
    flowCount: number;
    targetFlowCount: number;
    spilloverFlowCount: number;
    sinkSamples: string[];
    fallbackTarget: string;
    sinkRuleHits: Record<string, number>;
    ruleHits: {
        source: Record<string, number>;
        sink: Record<string, number>;
        transfer: Record<string, number>;
    };
}

interface EqReport {
    generatedAt: string;
    manifestPath: string;
    k: number;
    total: number;
    consistent: number;
    inconsistent: number;
    baselineAnalyzeFailures: number;
    mutatedAnalyzeFailures: number;
    byTransform: Record<string, { total: number; consistent: number; inconsistent: number }>;
    byCategory: Record<string, { total: number; consistent: number; inconsistent: number }>;
    inconsistentItems: AConsistencyItem[];
}

interface ChallengeReport {
    generatedAt: string;
    manifestPath: string;
    k: number;
    total: number;
    tp: number;
    fp: number;
    tn: number;
    fn: number;
    recall: number | null;
    precision: number | null;
    fpSafeControl: number;
    safeControlTotal: number;
    unrelatedSinkHits: number;
    spilloverRatio: number | null;
    byTransform: Record<string, { total: number; tp: number; fp: number; tn: number; fn: number }>;
    fallbackBacklog: Record<string, { fn: number; fp: number }>;
    items: BChallengeItem[];
}

interface GapItem {
    id: string;
    group: "A" | "B";
    categoryId: string;
    caseId: string;
    file: string;
    transform: string;
    classification: string;
    suggestedTrack: string;
    resolutionHint: string;
    evidence: string;
}

function parseGroups(input: string): HarmonyMutatorGroup[] {
    const out: HarmonyMutatorGroup[] = [];
    for (const p of input.split(",").map(x => x.trim().toUpperCase()).filter(Boolean)) {
        if ((p === "A" || p === "B") && !out.includes(p as HarmonyMutatorGroup)) {
            out.push(p as HarmonyMutatorGroup);
        }
    }
    return out.length > 0 ? out : ["A", "B"];
}

function parseArgs(argv: string[]): CliOptions {
    let manifestPath = "tests/benchmark/HarmonyBench/manifest.json";
    let outputDir = "tmp/test_runs/benchmark/harmony_bench_metamorphic/latest";
    let docsPath = "docs/harmony_bench_metamorphic.md";
    let k = 1;
    let groups: HarmonyMutatorGroup[] = ["A", "B"];
    let maxCasesPerCategory = 0;
    let categoryRegex = "^C[1-5]_";
    let semanticAnchorHintsPath: string | undefined;

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
        if (arg === "--outputDir" && i + 1 < argv.length) {
            outputDir = argv[++i];
            continue;
        }
        if (arg.startsWith("--outputDir=")) {
            outputDir = arg.slice("--outputDir=".length);
            continue;
        }
        if (arg === "--docs" && i + 1 < argv.length) {
            docsPath = argv[++i];
            continue;
        }
        if (arg.startsWith("--docs=")) {
            docsPath = arg.slice("--docs=".length);
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
        if (arg === "--groups" && i + 1 < argv.length) {
            groups = parseGroups(argv[++i]);
            continue;
        }
        if (arg.startsWith("--groups=")) {
            groups = parseGroups(arg.slice("--groups=".length));
            continue;
        }
        if (arg === "--maxCasesPerCategory" && i + 1 < argv.length) {
            maxCasesPerCategory = Number(argv[++i]);
            continue;
        }
        if (arg.startsWith("--maxCasesPerCategory=")) {
            maxCasesPerCategory = Number(arg.slice("--maxCasesPerCategory=".length));
            continue;
        }
        if (arg === "--categoryRegex" && i + 1 < argv.length) {
            categoryRegex = argv[++i];
            continue;
        }
        if (arg.startsWith("--categoryRegex=")) {
            categoryRegex = arg.slice("--categoryRegex=".length);
            continue;
        }
        if (arg === "--semanticAnchorHints" && i + 1 < argv.length) {
            semanticAnchorHintsPath = argv[++i];
            continue;
        }
        if (arg.startsWith("--semanticAnchorHints=")) {
            semanticAnchorHintsPath = arg.slice("--semanticAnchorHints=".length);
            continue;
        }
    }

    if (k !== 0 && k !== 1) {
        throw new Error(`Invalid --k value: ${k}`);
    }
    if (!Number.isFinite(maxCasesPerCategory) || maxCasesPerCategory < 0) {
        throw new Error(`Invalid --maxCasesPerCategory value: ${maxCasesPerCategory}`);
    }

    return {
        manifestPath: path.resolve(manifestPath),
        outputDir: path.resolve(outputDir),
        docsPath: path.resolve(docsPath),
        k,
        groups,
        maxCasesPerCategory,
        categoryRegex: new RegExp(categoryRegex),
        semanticAnchorHintsPath: semanticAnchorHintsPath ? path.resolve(semanticAnchorHintsPath) : undefined,
    };
}

function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

function buildScene(projectDir: string): Scene {
    const cfg = new SceneConfig();
    cfg.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(cfg);
    scene.inferTypes();
    registerMockSdkFiles(scene);
    return scene;
}

function classify(expectedFlow: boolean, detectedTarget: boolean, detectedAny: boolean): "TP" | "FP" | "TN" | "FN" {
    if (expectedFlow) return detectedTarget ? "TP" : "FN";
    return detectedAny ? "FP" : "TN";
}

function calcRecall(tp: number, fn: number): number | null {
    const denom = tp + fn;
    return denom === 0 ? null : tp / denom;
}

function calcPrecision(tp: number, fp: number): number | null {
    const denom = tp + fp;
    return denom === 0 ? null : tp / denom;
}

function fallbackTargetByTransform(transform: string): string {
    if (transform === "b_napi_boundary") return "7.9";
    if (transform === "b_higher_order_ds" || transform === "b_higher_order_ds_safe_control") return "7.8.6/7.9";
    if (transform === "b_dynamic_dispatch") return "7.9";
    return "7.8/7.9";
}

function isSafeControlTransform(transform: string): boolean {
    return transform.endsWith("_safe_control");
}

function suggestedTrackByTransform(transform: string, group: "A" | "B"): string {
    if (transform === "b_napi_boundary" || transform === "b_dynamic_dispatch" || transform === "a_async_equiv") {
        return "7.9";
    }
    if (transform === "b_higher_order_ds" || transform === "b_higher_order_ds_safe_control") {
        return "7.8.6/7.9";
    }
    if (group === "A") {
        return "7.8/7.9";
    }
    return "7.8/7.9";
}

function formatTopRuleHits(ruleHits: { source: Record<string, number>; sink: Record<string, number>; transfer: Record<string, number> }): string {
    const top = (rec: Record<string, number>): string => {
        const entries = Object.entries(rec).sort((a, b) => b[1] - a[1]).slice(0, 2);
        if (entries.length === 0) return "-";
        return entries.map(([k, v]) => `${k}:${v}`).join(",");
    };
    return `src[${top(ruleHits.source)}] sink[${top(ruleHits.sink)}] tr[${top(ruleHits.transfer)}]`;
}

function resolveHint(transform: string, classification: string): string {
    if (classification.includes("FP")) {
        return "rule_or_model_precision";
    }
    if (transform === "a_async_equiv" || transform === "b_dynamic_dispatch" || transform === "b_napi_boundary") {
        return "engine_required";
    }
    if (transform === "b_higher_order_ds" || transform === "b_higher_order_ds_safe_control") {
        return "engine_or_rule";
    }
    return "mixed";
}

function inferABreakReason(item: AConsistencyItem): string {
    const baselineSinkHits = Object.keys(item.baselineRuleHits.sink).length;
    const mutatedSinkHits = Object.keys(item.mutatedRuleHits.sink).length;
    if (baselineSinkHits > 0 && mutatedSinkHits === 0) {
        return "sink_not_reached_after_mutation";
    }
    if (item.baselineClassification === "TP" && item.mutatedClassification === "FN") {
        return "taint_chain_cut_after_mutation";
    }
    if (item.baselineClassification === "TN" && item.mutatedClassification === "FP") {
        return "over_taint_after_mutation";
    }
    return "classification_shift";
}

function inferBBreakReason(item: BChallengeItem): string {
    if (item.classification === "FN") {
        if (item.flowCount === 0) return "no_flow_reached_sink";
        return "sink_pattern_not_matched";
    }
    if (item.classification === "FP") {
        return "over_taint_or_loose_rule";
    }
    return "pass";
}

async function runCase(
    scene: Scene,
    caseInfo: HarmonyBenchCase,
    k: number,
    loadedRules: LoadedRuleSet,
    expectedSinkRuleIds: string[]
): Promise<AnalyzeResult> {
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
        const ruleHits = engine.getRuleHitCounters();
        const sinkSummary = summarizeSinkInventoryFlows(flows, loadedRules.ruleSet.sinks || [], expectedSinkRuleIds);
        const detectedAny = sinkSummary.detectedInventory;
        const classification = classify(caseInfo.expected_flow, sinkSummary.detectedTarget, detectedAny);
        const pass = caseInfo.expected_flow ? sinkSummary.detectedTarget : !detectedAny;

        return {
            ok: true,
            expectedFlow: caseInfo.expected_flow,
            detectedAny,
            detectedTarget: sinkSummary.detectedTarget,
            flowCount: flows.length,
            targetFlowCount: sinkSummary.targetFlowCount,
            spilloverFlowCount: sinkSummary.spilloverFlowCount,
            classification,
            pass,
            sinkSamples: flows.slice(0, 3).map((f: TaintFlow) => f.sink.toString()),
            sinkRuleHits: sinkSummary.sinkRuleHits,
            sinkFamilyHits: sinkSummary.sinkFamilyHits,
            sinkEndpointHits: sinkSummary.sinkEndpointHits,
            elapsedMs: Date.now() - start,
            seedCount: seedInfo.seedCount,
            ruleHits,
        };
    } catch (err: any) {
        return {
            ok: false,
            expectedFlow: caseInfo.expected_flow,
            detectedAny: false,
            detectedTarget: false,
            flowCount: 0,
            targetFlowCount: 0,
            spilloverFlowCount: 0,
            classification: caseInfo.expected_flow ? "FN" : "TN",
            pass: false,
            sinkSamples: [],
            sinkRuleHits: {},
            sinkFamilyHits: {},
            sinkEndpointHits: {},
            elapsedMs: Date.now() - start,
            seedCount: 0,
            ruleHits: { source: {}, sink: {}, transfer: {} },
            error: String(err?.message || err),
        };
    }
}

function renderSummaryMarkdown(eq: EqReport, challenge: ChallengeReport, options: CliOptions): string {
    const fmt = (v: number | null): string => (v === null ? "N/A" : `${(v * 100).toFixed(1)}%`);
    const lines: string[] = [];
    lines.push("# Harmony Metamorphic Report");
    lines.push("");
    lines.push(`- generatedAt: ${eq.generatedAt}`);
    lines.push(`- manifest: ${options.manifestPath}`);
    lines.push(`- k: ${options.k}`);
    lines.push(`- groups: ${options.groups.join(",")}`);
    lines.push("");
    lines.push("## A Group (Strict Equivalence)");
    lines.push("");
    lines.push(`- total: ${eq.total}`);
    lines.push(`- consistent: ${eq.consistent}`);
    lines.push(`- inconsistent: ${eq.inconsistent}`);
    lines.push(`- baselineAnalyzeFailures: ${eq.baselineAnalyzeFailures}`);
    lines.push(`- mutatedAnalyzeFailures: ${eq.mutatedAnalyzeFailures}`);
    lines.push("");
    lines.push("## B Group (Harmony Challenges)");
    lines.push("");
    lines.push(`- total: ${challenge.total}`);
    lines.push(`- TP/FP/TN/FN: ${challenge.tp}/${challenge.fp}/${challenge.tn}/${challenge.fn}`);
    lines.push(`- recall: ${fmt(challenge.recall)}`);
    lines.push(`- precision: ${fmt(challenge.precision)}`);
    lines.push(`- fp_safe_control: ${challenge.fpSafeControl}/${challenge.safeControlTotal}`);
    lines.push(`- unrelated_sink_hits: ${challenge.unrelatedSinkHits}`);
    lines.push(`- spillover_ratio: ${fmt(challenge.spilloverRatio)}`);
    lines.push("");
    lines.push("## B Group Fallback Mapping");
    lines.push("");
    for (const [target, count] of Object.entries(challenge.fallbackBacklog)) {
        lines.push(`- ${target}: FN=${count.fn}, FP=${count.fp}`);
    }
    lines.push("");
    lines.push("## Scoring Policy");
    lines.push("");
    lines.push("- Group A: strict equivalence mutations. Baseline and mutation must match under `expected_flow + target sink inventory`.");
    lines.push("- Group B: Harmony challenge mutations. Report TP/FP/TN/FN with fallback mapping; 100% consistency is not required.");
    lines.push("");
    if (eq.inconsistentItems.length > 0) {
        lines.push("## Group A Failed Cases (Top 10)");
        lines.push("");
        for (const item of eq.inconsistentItems.slice(0, 10)) {
            lines.push(`- ${item.categoryId}/${item.caseId}/${item.transform}: baseline=${item.baselineClassification}, mutated=${item.mutatedClassification}`);
            lines.push(`  - location: ${item.file}`);
            lines.push(`  - rule_hits(baseline): ${formatTopRuleHits(item.baselineRuleHits)}`);
            lines.push(`  - rule_hits(mutated): ${formatTopRuleHits(item.mutatedRuleHits)}`);
            lines.push(`  - break_reason: ${inferABreakReason(item)}`);
            lines.push(`  - suggested: ${suggestedTrackByTransform(item.transform, "A")} / ${resolveHint(item.transform, `${item.baselineClassification}->${item.mutatedClassification}`)}`);
        }
        lines.push("");
    }
    const bFails = challenge.items.filter(x => x.classification === "FP" || x.classification === "FN");
    if (bFails.length > 0) {
        lines.push("## Group B Failed Cases (Top 10)");
        lines.push("");
        for (const item of bFails.slice(0, 10)) {
            lines.push(`- ${item.categoryId}/${item.caseId}/${item.transform}: ${item.classification}, fallback=${item.fallbackTarget}`);
            lines.push(`  - location: ${item.file}`);
            lines.push(`  - rule_hits: ${formatTopRuleHits(item.ruleHits)}`);
            lines.push(`  - break_reason: ${inferBBreakReason(item)}`);
            lines.push(`  - suggested: ${resolveHint(item.transform, item.classification)}`);
        }
        lines.push("");
    }
    const resolution = { engine_required: 0, rule_or_model_precision: 0, engine_or_rule: 0, mixed: 0 };
    for (const item of eq.inconsistentItems) {
        const k = resolveHint(item.transform, `${item.baselineClassification}->${item.mutatedClassification}`) as keyof typeof resolution;
        resolution[k]++;
    }
    for (const item of bFails) {
        const k = resolveHint(item.transform, item.classification) as keyof typeof resolution;
        resolution[k]++;
    }
    lines.push("## Resolution Split");
    lines.push("");
    lines.push(`- engine_required: ${resolution.engine_required}`);
    lines.push(`- rule_or_model_precision: ${resolution.rule_or_model_precision}`);
    lines.push(`- engine_or_rule: ${resolution.engine_or_rule}`);
    lines.push(`- mixed: ${resolution.mixed}`);
    lines.push("");
    const ruleFix = resolution.rule_or_model_precision;
    const engineFix = resolution.engine_required;
    const hybrid = resolution.engine_or_rule + resolution.mixed;
    lines.push("## Rule vs Engine Split");
    lines.push("");
    lines.push(`- can_fix_by_rule_or_model_precision: ${ruleFix}`);
    lines.push(`- must_fix_by_engine_enhancement: ${engineFix}`);
    lines.push(`- hybrid_or_need_manual_triage: ${hybrid}`);
    lines.push("");
    lines.push("## Failure Evidence (Code Location + Rule Hits + Break Reason)");
    lines.push("");
    lines.push("| Group | Category | Case | Transform | Location | Break Reason | Rule Hits |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    for (const item of eq.inconsistentItems.slice(0, 20)) {
        lines.push(`| A | ${item.categoryId} | ${item.caseId} | ${item.transform} | ${item.file} | ${inferABreakReason(item)} | ${formatTopRuleHits(item.mutatedRuleHits)} |`);
    }
    for (const item of bFails.slice(0, 20)) {
        lines.push(`| B | ${item.categoryId} | ${item.caseId} | ${item.transform} | ${item.file} | ${inferBBreakReason(item)} | ${formatTopRuleHits(item.ruleHits)} |`);
    }
    lines.push("");
    lines.push("");
    return lines.join("\n");
}

function renderEqMarkdown(eq: EqReport): string {
    const lines: string[] = [];
    lines.push("# report_eq");
    lines.push("");
    lines.push("| Metric | Value |");
    lines.push("| --- | --- |");
    lines.push(`| total | ${eq.total} |`);
    lines.push(`| consistent | ${eq.consistent} |`);
    lines.push(`| inconsistent | ${eq.inconsistent} |`);
    lines.push(`| baselineAnalyzeFailures | ${eq.baselineAnalyzeFailures} |`);
    lines.push(`| mutatedAnalyzeFailures | ${eq.mutatedAnalyzeFailures} |`);
    lines.push("");
    lines.push("## By Transform");
    lines.push("");
    lines.push("| Transform | Total | Consistent | Inconsistent |");
    lines.push("| --- | ---: | ---: | ---: |");
    for (const [transform, stat] of Object.entries(eq.byTransform)) {
        lines.push(`| ${transform} | ${stat.total} | ${stat.consistent} | ${stat.inconsistent} |`);
    }
    lines.push("");
    if (eq.inconsistentItems.length > 0) {
        lines.push("## Inconsistent Items");
        lines.push("");
        lines.push("| Category | Case | Transform | Baseline | Mutated |");
        lines.push("| --- | --- | --- | --- | --- |");
        for (const item of eq.inconsistentItems) {
            lines.push(`| ${item.categoryId} | ${item.caseId} | ${item.transform} | ${item.baselineClassification} | ${item.mutatedClassification} |`);
        }
    }
    lines.push("");
    return lines.join("\n");
}

function renderChallengeMarkdown(report: ChallengeReport): string {
    const fmt = (v: number | null): string => (v === null ? "N/A" : `${(v * 100).toFixed(1)}%`);
    const lines: string[] = [];
    lines.push("# report_harmony_challenge");
    lines.push("");
    lines.push("| Metric | Value |");
    lines.push("| --- | --- |");
    lines.push(`| total | ${report.total} |`);
    lines.push(`| TP | ${report.tp} |`);
    lines.push(`| FP | ${report.fp} |`);
    lines.push(`| TN | ${report.tn} |`);
    lines.push(`| FN | ${report.fn} |`);
    lines.push(`| recall | ${fmt(report.recall)} |`);
    lines.push(`| precision | ${fmt(report.precision)} |`);
    lines.push(`| fp_safe_control | ${report.fpSafeControl}/${report.safeControlTotal} |`);
    lines.push(`| unrelated_sink_hits | ${report.unrelatedSinkHits} |`);
    lines.push(`| spillover_ratio | ${fmt(report.spilloverRatio)} |`);
    lines.push("");
    lines.push("## By Transform");
    lines.push("");
    lines.push("| Transform | Total | TP | FP | TN | FN |");
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: |");
    for (const [transform, stat] of Object.entries(report.byTransform)) {
        lines.push(`| ${transform} | ${stat.total} | ${stat.tp} | ${stat.fp} | ${stat.tn} | ${stat.fn} |`);
    }
    lines.push("");
    if (report.items.length > 0) {
        lines.push("## Case Items");
        lines.push("");
        lines.push("| Category | Case | Transform | Class | Fallback |");
        lines.push("| --- | --- | --- | --- | --- |");
        for (const item of report.items) {
            lines.push(`| ${item.categoryId} | ${item.caseId} | ${item.transform} | ${item.classification} | ${item.fallbackTarget} |`);
        }
        lines.push("");
    }
    return lines.join("\n");
}

function renderGapBacklog(eq: EqReport, challenge: ChallengeReport): string {
    const gapItems: GapItem[] = [];
    for (const item of eq.inconsistentItems) {
        gapItems.push({
            id: `A:${item.categoryId}:${item.caseId}:${item.transform}`,
            group: "A",
            categoryId: item.categoryId,
            caseId: item.caseId,
            file: item.file,
            transform: item.transform,
            classification: `${item.baselineClassification}->${item.mutatedClassification}`,
            suggestedTrack: suggestedTrackByTransform(item.transform, "A"),
            resolutionHint: resolveHint(item.transform, `${item.baselineClassification}->${item.mutatedClassification}`),
            evidence: `baseline=${item.baselineDetected}, mutated=${item.mutatedDetected}, hits=${formatTopRuleHits(item.mutatedRuleHits)}`,
        });
    }

    for (const item of challenge.items) {
        if (item.classification !== "FP" && item.classification !== "FN") {
            continue;
        }
        gapItems.push({
            id: `B:${item.categoryId}:${item.caseId}:${item.transform}`,
            group: "B",
            categoryId: item.categoryId,
            caseId: item.caseId,
            file: item.file,
            transform: item.transform,
            classification: item.classification,
            suggestedTrack: item.fallbackTarget,
            resolutionHint: resolveHint(item.transform, item.classification),
            evidence: `flows=${item.flowCount}, target=${item.targetFlowCount}, spillover=${item.spilloverFlowCount}, sink=${item.sinkSamples[0] || "N/A"}, hits=${formatTopRuleHits(item.ruleHits)}`,
        });
    }

    const lines: string[] = [];
    lines.push("# Harmony Metamorphic Gap Backlog");
    lines.push("");
    lines.push(`- generatedAt: ${new Date().toISOString()}`);
    lines.push(`- total_gap_items: ${gapItems.length}`);
    lines.push(`- A_inconsistent: ${eq.inconsistent}`);
    lines.push(`- B_fp_fn: ${challenge.fp + challenge.fn}`);
    lines.push("");
    lines.push("## Track Summary");
    lines.push("");
    lines.push("| Track | Count |");
    lines.push("| --- | ---: |");
    const trackStat = new Map<string, number>();
    for (const g of gapItems) {
        trackStat.set(g.suggestedTrack, (trackStat.get(g.suggestedTrack) || 0) + 1);
    }
    for (const [track, count] of [...trackStat.entries()].sort((a, b) => b[1] - a[1])) {
        lines.push(`| ${track} | ${count} |`);
    }
    lines.push("");
    lines.push("## Resolution Summary");
    lines.push("");
    lines.push("| Hint | Count |");
    lines.push("| --- | ---: |");
    const resolutionStat = new Map<string, number>();
    for (const g of gapItems) {
        resolutionStat.set(g.resolutionHint, (resolutionStat.get(g.resolutionHint) || 0) + 1);
    }
    for (const [hint, count] of [...resolutionStat.entries()].sort((a, b) => b[1] - a[1])) {
        lines.push(`| ${hint} | ${count} |`);
    }
    lines.push("");
    lines.push("## Gap Items");
    lines.push("");
    lines.push("| ID | Group | Category | Case | Transform | Class | Track | Resolution | Evidence |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const g of gapItems) {
        lines.push(`| ${g.id} | ${g.group} | ${g.categoryId} | ${g.caseId} | ${g.transform} | ${g.classification} | ${g.suggestedTrack} | ${g.resolutionHint} | ${g.evidence.replace(/\|/g, "/")} |`);
    }
    lines.push("");
    lines.push("## Discipline");
    lines.push("");
    lines.push("- This backlog drives 7.8/7.9 engine fixes; do not hide gaps by changing test semantics.");
    lines.push("- Re-run the exact same command after fixes and diff this backlog.");
    lines.push("");
    return lines.join("\n");
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const generatedRoot = path.join(options.outputDir, "generated");
    ensureDir(options.outputDir);

    const dataset = generateHarmonyMutationDataset({
        manifestPath: options.manifestPath,
        outputRoot: generatedRoot,
        groups: options.groups,
        maxCasesPerCategory: options.maxCasesPerCategory,
        categoryIdPattern: options.categoryRegex,
        semanticAnchorHintsPath: options.semanticAnchorHintsPath,
    });

    const baselineSceneCache = new Map<string, Scene>();
    const mutatedSceneCache = new Map<string, Scene>();
    const rulesCache = new Map<string, LoadedRuleSet>();
    const baselineCaseCache = new Map<string, AnalyzeResult>();

    const aItems: AConsistencyItem[] = [];
    const bItems: BChallengeItem[] = [];
    let baselineAnalyzeFailures = 0;
    let mutatedAnalyzeFailures = 0;
    const totalMutations = dataset.mutations.length;
    let processedMutations = 0;
    const progressStartMs = Date.now();

    for (const mutation of dataset.mutations) {
        const baselineSceneKey = mutation.sourceDirOriginal;
        let baselineScene = baselineSceneCache.get(baselineSceneKey);
        if (!baselineScene) {
            baselineScene = buildScene(mutation.sourceDirOriginal);
            baselineSceneCache.set(baselineSceneKey, baselineScene);
        }

        const mutatedSceneKey = mutation.sourceDirMutated;
        let mutatedScene = mutatedSceneCache.get(mutatedSceneKey);
        if (!mutatedScene) {
            mutatedScene = buildScene(mutation.sourceDirMutated);
            mutatedSceneCache.set(mutatedSceneKey, mutatedScene);
        }

        const rulesKey = [
            path.resolve(mutation.rulePaths.kernelRule),
            path.resolve(mutation.rulePaths.ruleCatalog),
            path.resolve(mutation.rulePaths.project),
        ].join("|");
        let loadedRules = rulesCache.get(rulesKey);
        if (!loadedRules) {
            loadedRules = loadRuleSet({
                kernelRulePath: path.resolve(mutation.rulePaths.kernelRule),
                ruleCatalogPath: path.resolve(mutation.rulePaths.ruleCatalog),
                projectRulePath: path.resolve(mutation.rulePaths.project),
                autoDiscoverLayers: false,
                allowMissingProject: false,
                allowMissingCandidate: true,
            });
            rulesCache.set(rulesKey, loadedRules);
        }
        const expectedSinkRuleIds = resolveExpectedSinkRuleIds(
            mutation.rulePaths.project,
            loadedRules.ruleSet.sinks || [],
        );

        const baselineCaseKey = `${rulesKey}|k=${options.k}|${mutation.sourceDirOriginal}|${mutation.sourceCase.case_id}|${mutation.sourceCase.file}|${mutation.sourceCase.entry}`;
        let baseline = baselineCaseCache.get(baselineCaseKey);
        if (!baseline) {
            baseline = await runCase(baselineScene, mutation.sourceCase, options.k, loadedRules, expectedSinkRuleIds);
            baselineCaseCache.set(baselineCaseKey, baseline);
        }

        const mutatedCase: HarmonyBenchCase = {
            ...mutation.sourceCase,
            file: mutation.mutatedFile,
        };
        let mutated = await runCase(mutatedScene, mutatedCase, options.k, loadedRules, expectedSinkRuleIds);
        const baselineIsReliable = baseline.ok
            && (baseline.classification === "TP" || baseline.classification === "TN");
        const needsIsolationRecheck = baselineIsReliable
            && mutated.ok
            && (mutated.classification === "FP" || mutated.classification === "FN");
        if (needsIsolationRecheck) {
            const isolated = await runCase(mutatedScene, mutatedCase, options.k, loadedRules, expectedSinkRuleIds);
            if (isolated.ok) {
                mutated = isolated;
            }
        }

        if (!baseline.ok) baselineAnalyzeFailures++;
        if (!mutated.ok) mutatedAnalyzeFailures++;
        if (!baseline.ok || !mutated.ok) continue;

        if (mutation.group === "A") {
            const consistent = baseline.detectedTarget === mutated.detectedTarget
                && baseline.classification === mutated.classification;
            aItems.push({
                group: "A",
                transform: mutation.transform,
                categoryId: mutation.categoryId,
                caseId: mutation.sourceCase.case_id,
                file: mutation.sourceCase.file,
                baselineDetected: baseline.detectedTarget,
                mutatedDetected: mutated.detectedTarget,
                baselineClassification: baseline.classification,
                mutatedClassification: mutated.classification,
                consistent,
                baselineRuleHits: baseline.ruleHits,
                mutatedRuleHits: mutated.ruleHits,
            });
        } else {
            bItems.push({
                group: "B",
                transform: mutation.transform,
                categoryId: mutation.categoryId,
                caseId: mutation.sourceCase.case_id,
                file: mutation.sourceCase.file,
                expectedFlow: mutation.sourceCase.expected_flow,
                classification: mutated.classification,
                detectedTarget: mutated.detectedTarget,
                flowCount: mutated.flowCount,
                targetFlowCount: mutated.targetFlowCount,
                spilloverFlowCount: mutated.spilloverFlowCount,
                sinkSamples: mutated.sinkSamples,
                fallbackTarget: fallbackTargetByTransform(mutation.transform),
                sinkRuleHits: mutated.sinkRuleHits,
                ruleHits: mutated.ruleHits,
            });
        }

        processedMutations++;
        if (processedMutations === 1 || processedMutations % 25 === 0 || processedMutations === totalMutations) {
            const elapsed = (Date.now() - progressStartMs) / 1000;
            const rate = processedMutations > 0 ? elapsed / processedMutations : 0;
            const remain = Math.max(0, totalMutations - processedMutations);
            const eta = rate * remain;
            console.log(
                `[metamorphic-progress] ${processedMutations}/${totalMutations} `
                + `(${((processedMutations / totalMutations) * 100).toFixed(1)}%) `
                + `elapsed=${elapsed.toFixed(1)}s eta=${eta.toFixed(1)}s `
                + `case=${mutation.categoryId}/${mutation.sourceCase.case_id}/${mutation.transform}`
            );
        }
    }

    const eqByTransform: Record<string, { total: number; consistent: number; inconsistent: number }> = {};
    const eqByCategory: Record<string, { total: number; consistent: number; inconsistent: number }> = {};
    for (const item of aItems) {
        if (!eqByTransform[item.transform]) {
            eqByTransform[item.transform] = { total: 0, consistent: 0, inconsistent: 0 };
        }
        if (!eqByCategory[item.categoryId]) {
            eqByCategory[item.categoryId] = { total: 0, consistent: 0, inconsistent: 0 };
        }
        eqByTransform[item.transform].total++;
        eqByCategory[item.categoryId].total++;
        if (item.consistent) {
            eqByTransform[item.transform].consistent++;
            eqByCategory[item.categoryId].consistent++;
        } else {
            eqByTransform[item.transform].inconsistent++;
            eqByCategory[item.categoryId].inconsistent++;
        }
    }

    const eqReport: EqReport = {
        generatedAt: new Date().toISOString(),
        manifestPath: options.manifestPath,
        k: options.k,
        total: aItems.length,
        consistent: aItems.filter(x => x.consistent).length,
        inconsistent: aItems.filter(x => !x.consistent).length,
        baselineAnalyzeFailures,
        mutatedAnalyzeFailures,
        byTransform: eqByTransform,
        byCategory: eqByCategory,
        inconsistentItems: aItems.filter(x => !x.consistent),
    };

    const challengeByTransform: Record<string, { total: number; tp: number; fp: number; tn: number; fn: number }> = {};
    const fallbackBacklog: Record<string, { fn: number; fp: number }> = {};
    for (const item of bItems) {
        if (!challengeByTransform[item.transform]) {
            challengeByTransform[item.transform] = { total: 0, tp: 0, fp: 0, tn: 0, fn: 0 };
        }
        challengeByTransform[item.transform].total++;
        challengeByTransform[item.transform][item.classification.toLowerCase() as "tp" | "fp" | "tn" | "fn"]++;
        if (!fallbackBacklog[item.fallbackTarget]) {
            fallbackBacklog[item.fallbackTarget] = { fn: 0, fp: 0 };
        }
        if (item.classification === "FN") fallbackBacklog[item.fallbackTarget].fn++;
        if (item.classification === "FP") fallbackBacklog[item.fallbackTarget].fp++;
    }

    const tp = bItems.filter(x => x.classification === "TP").length;
    const fp = bItems.filter(x => x.classification === "FP").length;
    const tn = bItems.filter(x => x.classification === "TN").length;
    const fn = bItems.filter(x => x.classification === "FN").length;
    const safeControlItems = bItems.filter(x => isSafeControlTransform(x.transform));
    const fpSafeControl = safeControlItems.filter(x => x.classification === "FP").length;
    const totalFlowCount = bItems.reduce((acc, x) => acc + x.flowCount, 0);
    const unrelatedSinkHits = bItems.reduce((acc, x) => acc + x.spilloverFlowCount, 0);
    const challengeReport: ChallengeReport = {
        generatedAt: new Date().toISOString(),
        manifestPath: options.manifestPath,
        k: options.k,
        total: bItems.length,
        tp,
        fp,
        tn,
        fn,
        recall: calcRecall(tp, fn),
        precision: calcPrecision(tp, fp),
        fpSafeControl,
        safeControlTotal: safeControlItems.length,
        unrelatedSinkHits,
        spilloverRatio: totalFlowCount > 0 ? unrelatedSinkHits / totalFlowCount : null,
        byTransform: challengeByTransform,
        fallbackBacklog,
        items: bItems,
    };

    const eqPath = path.join(options.outputDir, "report_eq.json");
    const eqMdPath = path.join(options.outputDir, "report_eq.md");
    const challengePath = path.join(options.outputDir, "report_harmony_challenge.json");
    const challengeMdPath = path.join(options.outputDir, "report_harmony_challenge.md");
    const gapBacklogPath = path.join(options.outputDir, "gap_backlog.md");
    fs.writeFileSync(eqPath, JSON.stringify(eqReport, null, 2), "utf-8");
    fs.writeFileSync(eqMdPath, renderEqMarkdown(eqReport), "utf-8");
    fs.writeFileSync(challengePath, JSON.stringify(challengeReport, null, 2), "utf-8");
    fs.writeFileSync(challengeMdPath, renderChallengeMarkdown(challengeReport), "utf-8");
    fs.writeFileSync(gapBacklogPath, renderGapBacklog(eqReport, challengeReport), "utf-8");
    fs.writeFileSync(options.docsPath, renderSummaryMarkdown(eqReport, challengeReport, options), "utf-8");

    console.log("====== Harmony Metamorphic (7.7.3) ======");
    console.log(`dataset_manifest=${path.join(generatedRoot, "generated_manifest.json")}`);
    console.log(`report_eq=${eqPath}`);
    console.log(`report_eq_md=${eqMdPath}`);
    console.log(`report_challenge=${challengePath}`);
    console.log(`report_challenge_md=${challengeMdPath}`);
    console.log(`gap_backlog=${gapBacklogPath}`);
    console.log(`docs=${options.docsPath}`);
    console.log(`A_total=${eqReport.total}`);
    console.log(`A_consistent=${eqReport.consistent}`);
    console.log(`A_inconsistent=${eqReport.inconsistent}`);
    console.log(`B_total=${challengeReport.total}`);
    console.log(`B_tp=${challengeReport.tp}`);
    console.log(`B_fp=${challengeReport.fp}`);
    console.log(`B_tn=${challengeReport.tn}`);
    console.log(`B_fn=${challengeReport.fn}`);
    console.log(`B_fp_safe_control=${challengeReport.fpSafeControl}/${challengeReport.safeControlTotal}`);
    console.log(`B_unrelated_sink_hits=${challengeReport.unrelatedSinkHits}`);

    if (eqReport.inconsistent > 0 || baselineAnalyzeFailures > 0 || mutatedAnalyzeFailures > 0) {
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});


