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
    summary: {
        totalFlows: number;
    };
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("diagnostics", "analyze_module_field_bridge_api");
    const repoRoot = resolveTestRunPath("diagnostics", "analyze_module_field_bridge_api", "fixtures", "repo");
    const moduleRoot = resolveTestRunPath("diagnostics", "analyze_module_field_bridge_api", "fixtures", "module_root");
    const baselineOutput = resolveTestRunPath("diagnostics", "analyze_module_field_bridge_api", "runs", "baseline");
    const moduleOutput = resolveTestRunPath("diagnostics", "analyze_module_field_bridge_api", "runs", "module");
    fs.rmSync(root, { recursive: true, force: true });

    const repoSourceDir = path.join(repoRoot, "src", "main", "ets");
    const moduleProjectDir = path.join(moduleRoot, "project", "field_demo");

    writeText(
        path.join(repoSourceDir, "EntryAbility.ets"),
        [
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
            "const box = new Vault();",
            "Remember(box, Source());",
            "Sink(box.saved);",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(moduleRoot, "field.rules.json"),
        JSON.stringify({
            schemaVersion: "2.0",
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
        }, null, 2),
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
        "--no-incremental",
        "--k", "1",
    ];

    runAnalyzeCli([
        ...sharedArgs,
        "--outputDir", baselineOutput,
    ]);
    runAnalyzeCli([
        ...sharedArgs,
        "--module-root", moduleRoot,
        "--enable-module-project", "field_demo",
        "--outputDir", moduleOutput,
    ]);

    const baseline = readAnalyzeSummary<AnalyzeSummary>(baselineOutput);
    const withModule = readAnalyzeSummary<AnalyzeSummary>(moduleOutput);

    assert(baseline.summary.totalFlows === 0, `baseline should have zero flows, got ${baseline.summary.totalFlows}`);
    assert(withModule.summary.totalFlows > 0, `module run should produce flows, got ${withModule.summary.totalFlows}`);

    console.log("PASS test_analyze_module_field_bridge_api");
    console.log(`baseline_total_flows=${baseline.summary.totalFlows}`);
    console.log(`module_total_flows=${withModule.summary.totalFlows}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
