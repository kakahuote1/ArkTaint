import * as fs from "fs";
import { renderMarkdownReport } from "../../cli/analyzeReport";
import { getAnalyzeSummaryMarkdownPath, runAnalyzeCli } from "../helpers/AnalyzeCliRunner";
import { resolveTestRunDir } from "../helpers/TestWorkspaceLayout";

function runAnalyze(outputDir: string): string {
    const args = [
        "--repo", "tests/demo/rule_transfer_variants",
        "--sourceDir", ".",
        "--kernelRule", "tests/rules/minimal.rules.json",
        "--project", "tests/rules/transfer_variants.rules.json",
        "--k", "1",
        "--maxEntries", "6",
        "--no-incremental",
        "--reportMode", "light",
        "--outputDir", outputDir,
    ];
    runAnalyzeCli(args);
    return getAnalyzeSummaryMarkdownPath(outputDir);
}

function section(md: string, title: string): string {
    const start = md.indexOf(title);
    if (start < 0) return "";
    const rest = md.slice(start + title.length);
    const nextHeader = rest.search(/\n### |\n## /);
    return nextHeader >= 0 ? rest.slice(0, nextHeader) : rest;
}

function assertNoUnappliedProjectLayerLeak(): void {
    const syntheticNoAppliedProject = renderMarkdownReport({
        generatedAt: "test",
        repo: "D:/cursor/workplace/project/account_app_harmonyos",
        sourceDirs: ["entry/src/main/ets"],
        profile: "default",
        reportMode: "light",
        k: 1,
        maxEntries: 1,
        ruleLayers: ["kernel"],
        ruleLayerStatus: [
            { name: "kernel", path: "src/models/kernel/rules", applied: true },
            { name: "project", path: "src/models/project/clearchat/rules", applied: false },
        ],
        summary: {
            totalEntries: 1,
            okEntries: 1,
            withSeeds: 1,
            withFlows: 0,
            totalFlows: 0,
            statusCount: { ok: 1 },
            ruleHits: { source: { "source.test": 1 }, sink: {}, transfer: {} },
            ruleHitEndpoints: { source: {}, sink: {}, transfer: {} },
            transferProfile: {
                ruleCheckCount: 0,
                ruleMatchCount: 0,
                endpointMatchCount: 0,
                resultCount: 0,
                dedupSkipCount: 0,
                elapsedMs: 0,
            },
            detectProfile: {
                detectCallCount: 0,
                sinksChecked: 0,
                sanitizerGuardCheckCount: 0,
                sanitizerGuardHitCount: 0,
                signatureMatchMs: 0,
                candidateResolveMs: 0,
                taintEvalMs: 0,
                sanitizerGuardMs: 0,
                traversalMs: 0,
                totalMs: 0,
            },
            stageProfile: {},
            transferNoHitReasons: {},
        },
        entries: [{
            entryName: "@arkMain",
            entryPathHint: "entry/src/main/ets",
            score: 100,
            status: "ok",
            seedCount: 1,
            seedStrategies: ["rule:source"],
            flowCount: 0,
            sinkSamples: [],
            flowRuleTraces: [],
            ruleHits: { source: { "source.test": 1 }, sink: {}, transfer: {} },
            transferProfile: {
                ruleCheckCount: 0,
                ruleMatchCount: 0,
                endpointMatchCount: 0,
                resultCount: 0,
                dedupSkipCount: 0,
                elapsedMs: 0,
            },
            detectProfile: {
                detectCallCount: 0,
                sinksChecked: 0,
                sanitizerGuardCheckCount: 0,
                sanitizerGuardHitCount: 0,
                signatureMatchMs: 0,
                candidateResolveMs: 0,
                taintEvalMs: 0,
                sanitizerGuardMs: 0,
                traversalMs: 0,
                totalMs: 0,
            },
            transferNoHitReasons: [],
        }],
    } as any);

    if (syntheticNoAppliedProject.includes("src/models/project/clearchat/rules")) {
        throw new Error("unapplied project layer leaked ClearChat rule path into guidance");
    }
    if (!syntheticNoAppliedProject.includes("reviewed project asset package for this analyzed project")) {
        throw new Error("missing neutral guidance when no project asset package is applied");
    }
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("analyze", "guidance");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });

    const mdPath = runAnalyze(root);
    if (!fs.existsSync(mdPath)) {
        throw new Error(`summary.md not found: ${mdPath}`);
    }
    const md = fs.readFileSync(mdPath, "utf-8");

    const header = "## Next Steps";
    const hitHeader = "### Hit Rules (Top)";
    const missHeader = "### No-Hit Reasons (Top)";
    const gapHeader = "### Suggested Rule Gaps (Top)";

    if (!md.includes(header)) throw new Error(`missing section: ${header}`);
    if (!md.includes(hitHeader)) throw new Error(`missing section: ${hitHeader}`);
    if (!md.includes(missHeader)) throw new Error(`missing section: ${missHeader}`);
    if (!md.includes(gapHeader)) throw new Error(`missing section: ${gapHeader}`);

    const hitText = section(md, hitHeader);
    const missText = section(md, missHeader);
    const gapText = section(md, gapHeader);

    if (!/\n- /.test(hitText)) throw new Error("Hit Rules section has no bullet lines");
    if (!/\n- /.test(missText)) throw new Error("No-Hit Reasons section has no bullet lines");
    if (!/\n- /.test(gapText)) throw new Error("Suggested Rule Gaps section has no bullet lines");

    assertNoUnappliedProjectLayerLeak();

    console.log("====== Analyze Guidance Test ======");
    console.log(`summary_md=${mdPath}`);
    console.log("guidance_section_present=true");
    console.log("unapplied_project_layer_path_leak=false");
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
