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
        withFlows: number;
        totalFlows: number;
    };
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("diagnostics", "analyze_module_callback_api");
    const repoRoot = resolveTestRunPath("diagnostics", "analyze_module_callback_api", "fixtures", "repo");
    const moduleRoot = resolveTestRunPath("diagnostics", "analyze_module_callback_api", "fixtures", "module_root");
    const baselineOutput = resolveTestRunPath("diagnostics", "analyze_module_callback_api", "runs", "baseline");
    const moduleOutput = resolveTestRunPath("diagnostics", "analyze_module_callback_api", "runs", "module");
    fs.rmSync(root, { recursive: true, force: true });

    const repoSourceDir = path.join(repoRoot, "src", "main", "ets");
    const callbackProjectDir = path.join(moduleRoot, "project", "callback_demo");

    writeText(
        path.join(repoSourceDir, "EntryAbility.ets"),
        [
            "import { UIAbility } from '@kit.AbilityKit';",
            "",
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "",
            "function Register(value: string, callback: (observed: string) => void): void {}",
            "",
            "function Sink(v: string): void {}",
            "",
            "export default class EntryAbility extends UIAbility {",
            "  onCreate(): void {",
            "    const value = Source();",
            "    Register(value, (observed: string) => {",
            "      Sink(observed);",
            "    });",
            "  }",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(moduleRoot, "callback.rules.json"),
        JSON.stringify({
            schemaVersion: "2.0",
            sources: [
                {
                    id: "source.fixture.callback",
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
                    id: "sink.fixture.callback",
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
        path.join(callbackProjectDir, "callback_bridge.ts"),
        [
            `import { defineModule } from "@arktaint/module";`,
            "",
            "export default defineModule({",
            "  id: \"fixture.callback_bridge\",",
            "  description: \"Bridge Register(value, callback) into callback param 0.\",",
            "  setup(ctx) {",
            "    const relay = ctx.bridge.nodeRelay();",
            "    for (const call of ctx.scan.invokes({ methodName: \"Register\", minArgs: 2 })) {",
            "      relay.connectInvokeArgToCallbackParam(call, 0, 1, 0, { maxCandidates: 8 });",
            "      ctx.deferred.imperativeFromInvoke(call, 1, {",
            "        reason: \"Fixture-CallbackBinding\",",
            "      });",
            "    }",
            "    return {",
            "      onFact(event) {",
            "        return relay.emitPreserve(event, \"Fixture-CallbackBridge\", { allowUnreachableTarget: true });",
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
        "--project", path.join(moduleRoot, "callback.rules.json"),
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
        "--enable-module-project", "callback_demo",
        "--outputDir", moduleOutput,
    ]);

    const baseline = readAnalyzeSummary<AnalyzeSummary>(baselineOutput);
    const withModule = readAnalyzeSummary<AnalyzeSummary>(moduleOutput);

    assert(baseline.summary.totalFlows === 0, `baseline should have zero flows, got ${baseline.summary.totalFlows}`);
    assert(withModule.summary.totalFlows > 0, `module run should produce flows, got ${withModule.summary.totalFlows}`);

    console.log("PASS test_analyze_module_callback_api");
    console.log(`baseline_total_flows=${baseline.summary.totalFlows}`);
    console.log(`module_total_flows=${withModule.summary.totalFlows}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
