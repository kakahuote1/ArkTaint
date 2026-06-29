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
    const root = resolveTestRunDir("diagnostics", "analyze_type_narrowing_guard_partial_path_survival");
    const repoRoot = resolveTestRunPath("diagnostics", "analyze_type_narrowing_guard_partial_path_survival", "fixtures", "repo");
    const moduleRoot = resolveTestRunPath("diagnostics", "analyze_type_narrowing_guard_partial_path_survival", "fixtures", "module_root");
    const baselineOutput = resolveTestRunPath("diagnostics", "analyze_type_narrowing_guard_partial_path_survival", "runs", "baseline");
    const moduleOutput = resolveTestRunPath("diagnostics", "analyze_type_narrowing_guard_partial_path_survival", "runs", "module");
    fs.rmSync(root, { recursive: true, force: true });
    const repoSourceDir = path.join(repoRoot, "src", "main", "ets");
    const moduleProjectDir = path.join(moduleRoot, "project", "partial_path_survival", "modules");
    writeText(path.join(repoSourceDir, "EntryAbility.ets"), [
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
        "function SafeValue(): string {",
        "  return \"safe\";",
        "}",
        "",
        "function Merge(box: Vault, left: string, right: string): void {}",
        "",
        "function Sink(v: string): void {}",
        "",
        "export default class EntryAbility extends UIAbility {",
        "  onCreate(): void {",
        "    const box = new Vault();",
        "    const source = Source();",
        "    const left = source;",
        "    const right = source;",
        "    const y = \"abc\";",
        "    if (typeof y === \"number\") {",
        "      Merge(box, left, SafeValue());",
        "    }",
        "    Merge(box, SafeValue(), right);",
        "    Sink(box.saved);",
        "  }",
        "}",
        "",
    ].join("\n"));
    writeText(path.join(moduleRoot, "partial_path_survival.rules.json"), stringifyRuleAssetFixture({
        id: "asset.rule.fixture.partial_path_survival",
        sources: [
            {
                id: "source.fixture.partial_path_survival",
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
                id: "sink.fixture.partial_path_survival",
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
    writeText(path.join(moduleProjectDir, "partial_path_survival_bridge.ts"), [
        "import { defineModule } from \"@arktaint/module\";",
        "",
        "export default defineModule({",
        "  id: \"fixture.partial_path_survival_bridge\",",
        "  description: \"Bridge only the matching Merge arguments into box.saved.\",",
        "  setup(ctx) {",
        "    const mergeCalls = ctx.scan.invokes({ methodName: \"Merge\" }).filter(call => call.args().length >= 3);",
        "    return {",
        "      onFact(event) {",
        "        const localName = event.current.value?.getName?.();",
        "        if (localName !== \"left\" && localName !== \"right\") return;",
        "        const emissions = [];",
        "        for (const call of mergeCalls) {",
        "          const target = call.arg(0);",
        "          if (!target) continue;",
        "          const leftArgName = call.arg(1)?.getName?.();",
        "          const rightArgName = call.arg(2)?.getName?.();",
        "          if (localName === \"left\" && leftArgName === \"left\") {",
        "            emissions.push(...event.emit.toValueField(target, [\"saved\"], \"Fixture-PartialPathLeft\"));",
        "          }",
        "          if (localName === \"right\" && rightArgName === \"right\") {",
        "            emissions.push(...event.emit.toValueField(target, [\"saved\"], \"Fixture-PartialPathRight\"));",
        "          }",
        "        }",
        "        return emissions.length > 0 ? emissions : undefined;",
        "      },",
        "    };",
        "  },",
        "});",
        "",
    ].join("\n"));
    const sharedArgs = [
        "--repo", repoRoot,
        "--sourceDir", "src/main/ets",
        "--project", path.join(moduleRoot, "partial_path_survival.rules.json"),
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
        "--enable-model", "partial_path_survival:modules",
        "--outputDir", moduleOutput,
    ]);
    const baseline = readAnalyzeSummary<AnalyzeSummary>(baselineOutput);
    const withModule = readAnalyzeSummary<AnalyzeSummary>(moduleOutput);
    assert(baseline.summary.totalFlows === 0, `baseline should have zero flows, got ${baseline.summary.totalFlows}`);
    assert(withModule.reportMode === "full", `expected reportMode=full, got ${withModule.reportMode}`);
    assert(withModule.summary.totalFlows === 1, `expected exactly one surviving flow, got ${withModule.summary.totalFlows}`);
    const materializedEntries = (withModule.entries || []).filter(entry => Array.isArray(entry.materializedTaintFlows) && entry.materializedTaintFlows.length > 0);
    assert(materializedEntries.length === 1, `expected exactly one entry with materialized flows, got ${materializedEntries.length}`);
    const materialized = materializedEntries[0].materializedTaintFlows || [];
    assert(materialized.length === 1, `expected exactly one materialized taint flow, got ${materialized.length}`);
    assert(materialized[0].paths.length >= 1, `expected at least one surviving witness path, got ${materialized[0].paths.length}`);
    const normalizedPaths = materialized[0].paths
        .map(pathItem => pathItem.factIds.join(" -> "))
        .sort();
    console.log("PASS test_analyze_type_narrowing_guard_partial_path_survival");
    console.log(`baseline_total_flows=${baseline.summary.totalFlows}`);
    console.log(`module_total_flows=${withModule.summary.totalFlows}`);
    console.log(`surviving_paths=${materialized[0].paths.length}`);
    for (const pathText of normalizedPaths) {
        console.log(`path=${pathText}`);
    }
}
main().catch((error) => {
    console.error("FAIL test_analyze_type_narrowing_guard_partial_path_survival");
    console.error(error);
    process.exit(1);
});
