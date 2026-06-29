import * as fs from "fs";
import * as path from "path";
import { readAnalyzeSummary, runAnalyzeCli } from "../helpers/AnalyzeCliRunner";
import { stringifyRuleAssetFixture } from "../helpers/RuleAssetFixtureFactory";
import { resolveTestRunDir, resolveTestRunPath } from "../helpers/TestWorkspaceLayout";
function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}
function writeText(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
}
interface AnalyzeSummary {
    summary: {
        totalFlows: number;
        partialFlows?: number;
        statusCounts?: Record<string, number>;
        transferNoHitReasons?: Record<string, number>;
    };
    entries: Array<{
        status: string;
        flowCount: number;
        detectProfile?: {
            detectCallCount?: number;
        };
        stageProfile?: {
            buildPagProfile?: Record<string, number>;
            sourceRulePropagationProfile?: Record<string, number>;
        };
        transferNoHitReasons?: string[];
    }>;
}
async function main(): Promise<void> {
    const root = resolveTestRunDir("diagnostics", "analyze_budget_truncation_runs_sink_detection");
    const repoRoot = resolveTestRunPath("diagnostics", "analyze_budget_truncation_runs_sink_detection", "fixtures", "repo");
    const rulePath = resolveTestRunPath("diagnostics", "analyze_budget_truncation_runs_sink_detection", "fixtures", "rules.json");
    const outputDir = resolveTestRunPath("diagnostics", "analyze_budget_truncation_runs_sink_detection", "runs", "truncated");
    fs.rmSync(root, { recursive: true, force: true });
    const repoSourceDir = path.join(repoRoot, "src", "main", "ets");
    writeText(path.join(repoSourceDir, "EntryAbility.ets"), [
        "import { UIAbility } from '@kit.AbilityKit';",
        "",
        "function Source(): string {",
        "  return 'tainted';",
        "}",
        "",
        "function Sink(value: string): void {}",
        "",
        "export default class EntryAbility extends UIAbility {",
        "  onCreate(): void {",
        "    const x = Source();",
        "    const y = x;",
        "    Sink(y);",
        "  }",
        "}",
        "",
    ].join("\n"));
    writeText(rulePath, stringifyRuleAssetFixture({
        id: "asset.rule.fixture.budget_truncation",
        sources: [
            {
                id: "source.fixture.budget_truncation",
                sourceKind: "call_return",
                surface: {
                    kind: "invoke",
                    methodName: "Source"
                },
                target: "result"
            }
        ],
        sinks: [
            {
                id: "sink.fixture.budget_truncation",
                surface: {
                    kind: "invoke",
                    methodName: "Sink"
                },
                target: "arg0"
            }
        ],
        sanitizers: [],
        transfers: []
    }));
    runAnalyzeCli([
        "--repo", repoRoot,
        "--sourceDir", "src/main/ets",
        "--project", rulePath,
        "--reportMode", "full",
        "--no-incremental",
        "--worklistMaxDequeues", "1",
        "--outputDir", outputDir,
    ]);
    const summary = readAnalyzeSummary<AnalyzeSummary>(outputDir);
    const entry = summary.entries[0];
    assert(entry, "expected one analysis entry");
    assert(entry.status === "budget_exceeded", `truncated entry must remain budget_exceeded, got ${entry.status}`);
    assert((entry.transferNoHitReasons || []).some(reason => reason.startsWith("propagation_budget_exceeded")), `expected propagation budget reason, got ${(entry.transferNoHitReasons || []).join(",")}`);
    assert((entry.detectProfile?.detectCallCount || 0) > 0, "sink detection should run even after worklist truncation");
    assert((entry.stageProfile?.buildPagProfile?.totalMs || 0) > 0, "expected buildPAG subphase profile to be recorded");
    assert((entry.stageProfile?.sourceRulePropagationProfile?.totalMs || 0) > 0, "expected source-rule propagation subphase profile to be recorded");
    assert(summary.summary.totalFlows === 0, `budget-truncated partial flows must not count as complete totalFlows, got ${summary.summary.totalFlows}`);
    assert((summary.summary.partialFlows || 0) > 0, `expected partial flow evidence, got ${summary.summary.partialFlows || 0}`);
    assert(entry.flowCount > 0, `expected entry flow evidence, got ${entry.flowCount}`);
    console.log("PASS test_analyze_budget_truncation_runs_sink_detection");
    console.log(`status=${entry.status}`);
    console.log(`total_flows=${summary.summary.totalFlows}`);
    console.log(`partial_flows=${summary.summary.partialFlows || 0}`);
    console.log(`detect_calls=${entry.detectProfile?.detectCallCount || 0}`);
}
main().catch((error) => {
    console.error("FAIL test_analyze_budget_truncation_runs_sink_detection");
    console.error(error);
    process.exit(1);
});
