import * as fs from "fs";
import * as path from "path";
import { readAnalyzeSummary, runAnalyzeCli } from "../helpers/AnalyzeCliRunner";
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
    const root = resolveTestRunDir("diagnostics", "analyze_materialized_taint_flow_branching");
    const repoRoot = resolveTestRunPath("diagnostics", "analyze_materialized_taint_flow_branching", "fixtures", "repo");
    const moduleRoot = resolveTestRunPath("diagnostics", "analyze_materialized_taint_flow_branching", "fixtures", "module_root");
    const baselineOutput = resolveTestRunPath("diagnostics", "analyze_materialized_taint_flow_branching", "runs", "baseline");
    const moduleOutput = resolveTestRunPath("diagnostics", "analyze_materialized_taint_flow_branching", "runs", "module");
    fs.rmSync(root, { recursive: true, force: true });

    const repoSourceDir = path.join(repoRoot, "src", "main", "ets");
    const moduleProjectDir = path.join(moduleRoot, "project", "branching_demo", "modules");

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
            "    Merge(box, left, right);",
            "    Sink(box.saved);",
            "  }",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(moduleRoot, "branching.rules.json"),
        JSON.stringify({
            schemaVersion: "2.0",
            sources: [
                {
                    id: "source.fixture.branching",
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
                    id: "sink.fixture.branching",
                    match: {
                        kind: "method_name_equals",
                        value: "Sink",
                    },
                    target: "arg0",
                },
            ],
            sanitizers: [],
            transfers: [],
        }, null, 2),
    );

    writeText(
        path.join(moduleProjectDir, "branching_bridge.ts"),
        [
            `import { defineModule } from "@arktaint/module";`,
            "",
            "export default defineModule({",
            "  id: \"fixture.branching_bridge\",",
            "  description: \"Bridge left/right facts into the Merge target field box.saved.\",",
            "  setup(ctx) {",
            "    const mergeCalls = ctx.scan.invokes({ methodName: \"Merge\", minArgs: 3 });",
            "    return {",
            "      onFact(event) {",
            "        const localName = event.current.value?.getName?.();",
            "        if (localName !== \"left\" && localName !== \"right\") return;",
            "        const emissions = [];",
            "        for (const call of mergeCalls) {",
            "          const target = call.arg(0);",
            "          if (!target) continue;",
            "          const reason = localName === \"left\" ? \"Fixture-BranchingLeft\" : \"Fixture-BranchingRight\";",
            "          emissions.push(...event.emit.toValueField(target, [\"saved\"], reason));",
            "        }",
            "        return emissions.length > 0 ? emissions : undefined;",
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
        "--project", path.join(moduleRoot, "branching.rules.json"),
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
        "--enable-model", "branching_demo:modules",
        "--outputDir", moduleOutput,
    ]);

    const baseline = readAnalyzeSummary<AnalyzeSummary>(baselineOutput);
    const withModule = readAnalyzeSummary<AnalyzeSummary>(moduleOutput);

    assert(baseline.summary.totalFlows === 0, `baseline should have zero flows, got ${baseline.summary.totalFlows}`);
    assert(withModule.reportMode === "full", `expected reportMode=full, got ${withModule.reportMode}`);
    assert(withModule.summary.totalFlows === 1, `expected exactly one flow, got ${withModule.summary.totalFlows}`);

    const materializedEntries = (withModule.entries || []).filter(entry =>
        Array.isArray(entry.materializedTaintFlows) && entry.materializedTaintFlows.length > 0
    );
    assert(materializedEntries.length === 1, `expected exactly one entry with materialized flows, got ${materializedEntries.length}`);

    const materialized = materializedEntries[0].materializedTaintFlows || [];
    assert(materialized.length === 1, `expected exactly one materialized taint flow, got ${materialized.length}`);
    assert(materialized[0].paths.length === 2, `expected  two witness paths, got ${materialized[0].paths.length}`);

    const normalizedPaths = materialized[0].paths
        .map(pathItem => pathItem.factIds.join(" -> "))
        .sort();
    assert(
        normalizedPaths[0] !== normalizedPaths[1],
        `expected two distinct materialized paths, got ${JSON.stringify(normalizedPaths)}`
    );

    console.log("PASS test_analyze_materialized_taint_flow_branching");
    console.log(`baseline_total_flows=${baseline.summary.totalFlows}`);
    console.log(`module_total_flows=${withModule.summary.totalFlows}`);
    console.log(`materialized_paths=${materialized[0].paths.length}`);
    for (const pathText of normalizedPaths) {
        console.log(`path=${pathText}`);
    }
}

main().catch((error) => {
    console.error("FAIL test_analyze_materialized_taint_flow_branching");
    console.error(error);
    process.exit(1);
});
