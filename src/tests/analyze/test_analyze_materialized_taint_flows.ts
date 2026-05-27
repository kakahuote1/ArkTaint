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
    reportMode: "light" | "full";
    summary: {
        totalFlows: number;
    };
    entries: Array<{
        entryName: string;
        flowCount: number;
        materializedTaintFlows?: Array<{
            sinkFactId: string;
            paths: Array<{
                factIds: string[];
                truncated?: boolean;
            }>;
        }>;
    }>;
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("diagnostics", "analyze_materialized_taint_flows");
    const repoRoot = resolveTestRunPath("diagnostics", "analyze_materialized_taint_flows", "fixtures", "repo");
    const moduleRoot = resolveTestRunPath("diagnostics", "analyze_materialized_taint_flows", "fixtures", "module_root");
    const baselineOutput = resolveTestRunPath("diagnostics", "analyze_materialized_taint_flows", "runs", "baseline");
    const moduleOutput = resolveTestRunPath("diagnostics", "analyze_materialized_taint_flows", "runs", "module");
    fs.rmSync(root, { recursive: true, force: true });

    const repoSourceDir = path.join(repoRoot, "src", "main", "ets");
    const moduleProjectDir = path.join(moduleRoot, "project", "field_demo", "modules");

    writeText(
        path.join(repoSourceDir, "EntryAbility.ets"),
        [
            "import { UIAbility } from '@kit.AbilityKit';",
            "",
            "class Vault {",
            "  saved: string = \"\";",
            "}",
            "",
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "",
            "function Remember(box: Vault, value: string): void {}",
            "",
            "function Sink(v: string): void {}",
            "",
            "export default class EntryAbility extends UIAbility {",
            "  onCreate(): void {",
            "    const box = new Vault();",
            "    Remember(box, Source());",
            "    Sink(box.saved);",
            "  }",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(moduleRoot, "field.rules.json"),
        stringifyRuleAssetFixture({
            id: "asset.rule.fixture.field",
            sources: [
                {
                    id: "source.fixture.field",
                    sourceKind: "call_return",
                    match: {
                        kind: "method_name_equals",
                        value: "Source",
                    },
                    target: "result",
                },
            ],
            sinks: [
                {
                    id: "sink.fixture.field",
                    match: {
                        kind: "method_name_equals",
                        value: "Sink",
                    },
                    target: "arg0",
                },
            ],
            sanitizers: [],
            transfers: [],
        }),
    );

    writeText(
        path.join(moduleProjectDir, "field_bridge.ts"),
        [
            `import { defineModule } from "@arktaint/module";`,
            "",
            "export default defineModule({",
            "  id: \"fixture.field_bridge\",",
            "  description: \"Bridge Remember(box, value) into box.saved.\",",
            "  setup() {",
            "    return {",
            "      onInvoke(event) {",
            "        if (!event.call.matchesMethod(\"Remember\")) return;",
            "        const target = event.values.arg(0);",
            "        if (!target) return;",
            "        if (!event.match.arg(1)) return;",
            "        return event.emit.toValueField(target, [\"saved\"], \"Fixture-FieldBridge\");",
            "      },",
            "    };",
            "  },",
            "});",
            "",
        ].join("\n"),
    );

    const sharedArgs = [
        "--repo", repoRoot,
        "--sourceDir", "src/main/ets",
        "--project", path.join(moduleRoot, "field.rules.json"),
        "--reportMode", "full",
        "--no-incremental",
        "--k", "1",
    ];

    runAnalyzeCli([
        ...sharedArgs,
        "--outputDir", baselineOutput,
    ]);
    runAnalyzeCli([
        ...sharedArgs,
        "--model-root", moduleRoot,
        "--enable-model", "field_demo:modules",
        "--outputDir", moduleOutput,
    ]);

    const baseline = readAnalyzeSummary<AnalyzeSummary>(baselineOutput);
    const withModule = readAnalyzeSummary<AnalyzeSummary>(moduleOutput);

    assert(baseline.summary.totalFlows === 0, `baseline should have zero flows, got ${baseline.summary.totalFlows}`);
    assert(withModule.reportMode === "full", `expected reportMode=full, got ${withModule.reportMode}`);
    assert(withModule.summary.totalFlows > 0, `module run should produce flows, got ${withModule.summary.totalFlows}`);

    const materializedEntries = (withModule.entries || []).filter(entry =>
        Array.isArray(entry.materializedTaintFlows) && entry.materializedTaintFlows.length > 0
    );
    assert(materializedEntries.length > 0, "expected at least one entry with materializedTaintFlows");

    const allPaths = materializedEntries.flatMap(entry =>
        (entry.materializedTaintFlows || []).flatMap(item => item.paths || [])
    );
    assert(allPaths.length > 0, "expected at least one materialized witness path");
    assert(
        allPaths.every(path => Array.isArray(path.factIds) && path.factIds.length >= 2),
        "expected every materialized witness path to contain at least 2 facts"
    );

    console.log("PASS test_analyze_materialized_taint_flows");
    console.log(`baseline_total_flows=${baseline.summary.totalFlows}`);
    console.log(`module_total_flows=${withModule.summary.totalFlows}`);
    console.log(`materialized_entries=${materializedEntries.length}`);
    console.log(`materialized_paths=${allPaths.length}`);
}

main().catch((error) => {
    console.error("FAIL test_analyze_materialized_taint_flows");
    console.error(error);
    process.exit(1);
});
