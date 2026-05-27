import { readAnalyzeSummary, runAnalyzeCli } from "../helpers/AnalyzeCliRunner";
import { stringifyRuleAssetFixture } from "../helpers/RuleAssetFixtureFactory";
import { resolveTestRunDir, resolveTestRunPath } from "../helpers/TestWorkspaceLayout";
import * as fs from "fs";
import * as path from "path";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

interface AnalyzeSummary {
    reportMode: "light" | "full";
    summary: { totalFlows: number; withSeeds: number };
    entries: Array<{
        entryName: string;
        status: string;
        materializedTaintFlows?: Array<{
            sinkFactId: string;
            judgement?: string;
            evidenceKinds?: string[];
            paths: Array<{ judgement?: string; evidenceKinds?: string[] }>;
        }>;
        postsolveResults?: Array<{
            flow: { sinkFactId?: string; sinkText: string };
            evidenceSummary: { evidenceKinds: string[]; primaryReason?: string };
            judgement: { kind: string };
            paths: Array<{ judgement: { kind: string }; evidence: Array<{ kind: string }> }>;
        }>;
    }>;
}

function writeText(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("analyze", "sanitizer_postsolve_refinement");
    const caseRoot = resolveTestRunPath("analyze", "sanitizer_postsolve_refinement", "sanitizer_result_and_retaint");
    const repoRoot = path.join(caseRoot, "repo");
    const outputDir = path.join(caseRoot, "out");
    const sourceDir = path.join(repoRoot, "src", "main", "ets");
    const rulePath = path.join(caseRoot, "sanitizer_postsolve.rules.json");

    fs.rmSync(root, { recursive: true, force: true });

    writeText(
        path.join(sourceDir, "EntryAbility.ets"),
        [
            "import { UIAbility } from '@kit.AbilityKit';",
            "",
            "function Escape(v: string): string { return v; }",
            "function Sink(_v: string): void {}",
            "",
            "export default class EntryAbility extends UIAbility {",
            "  onCreate(taint_src: string): void {",
            "    const clean = Escape(taint_src);",
            "    Sink(clean);",
            "    const mixed = clean + taint_src;",
            "    Sink(mixed);",
            "  }",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        rulePath,
        stringifyRuleAssetFixture({
            id: "asset.rule.fixture.sanitizer_postsolve",
            sources: [{
                id: "source.fixture.sanitizer_postsolve",
                sourceKind: "entry_param",
                match: { kind: "local_name_regex", value: "^taint_src$" },
                target: "arg0",
            }],
            sinks: [{
                id: "sink.fixture.sanitizer_postsolve",
                match: { kind: "method_name_equals", value: "Sink" },
                target: "arg0",
            }],
            sanitizers: [{
                id: "sanitizer.fixture.escape.result",
                match: { kind: "method_name_equals", value: "Escape" },
                target: "result",
            }],
            transfers: [{
                id: "transfer.fixture.escape.arg0_to_result",
                match: { kind: "method_name_equals", value: "Escape" },
                from: "arg0",
                to: "result",
            }],
        }),
    );

    runAnalyzeCli([
        "--repo", repoRoot,
        "--sourceDir", ".",
        "--project", rulePath,
        "--kernelRule", "tests/rules/minimal.rules.json",
        "--reportMode", "full",
        "--no-incremental",
        "--k", "1",
        "--outputDir", outputDir,
    ]);

    const report = readAnalyzeSummary<AnalyzeSummary>(outputDir);
    const entry = report.entries.find(item => item.entryName === "@arkMain") || report.entries[0];
    assert(report.reportMode === "full", `expected reportMode=full, got ${report.reportMode}`);
    assert(report.summary.withSeeds > 0, "expected withSeeds > 0");
    assert(entry?.status === "ok", `expected ok entry, got ${entry?.status}`);
    assert(report.summary.totalFlows === 1, `expected only re-tainted flow to survive, got ${report.summary.totalFlows}`);

    const results = entry.postsolveResults || [];
    const sanitized = results.find(item => item.evidenceSummary.evidenceKinds.includes("sanitizer_rule"));
    assert(sanitized, `expected sanitizer_rule evidence, got ${JSON.stringify(results.map(item => item.evidenceSummary.evidenceKinds))}`);
    assert(sanitized!.judgement.kind === "Refuted-Strong", `expected sanitizer flow refuted, got ${sanitized!.judgement.kind}`);
    assert(results.some(item => item.judgement.kind !== "Refuted-Strong"), "expected re-tainted mixed flow to survive");
    assert(
        (entry.materializedTaintFlows || []).some(item => item.sinkFactId === sanitized!.flow.sinkFactId && item.judgement === "Refuted-Strong"),
        "expected materializedTaintFlows to include refuted flow judgement for report alignment",
    );

    console.log("PASS test_analyze_sanitizer_postsolve_refinement");
    console.log(`surviving_total_flows=${report.summary.totalFlows}`);
    console.log(`postsolve_results=${results.length}`);
}

main().catch(error => {
    console.error("FAIL test_analyze_sanitizer_postsolve_refinement");
    console.error(error);
    process.exit(1);
});
