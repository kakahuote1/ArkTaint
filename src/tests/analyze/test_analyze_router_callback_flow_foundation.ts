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
        postsolveResults?: Array<unknown>;
    }>;
}
async function main(): Promise<void> {
    const root = resolveTestRunDir("diagnostics", "analyze_router_callback_flow_foundation");
    const repoRoot = resolveTestRunPath("diagnostics", "analyze_router_callback_flow_foundation", "fixtures", "repo");
    const moduleRoot = resolveTestRunPath("diagnostics", "analyze_router_callback_flow_foundation", "fixtures", "module_root");
    const baselineOutput = resolveTestRunPath("diagnostics", "analyze_router_callback_flow_foundation", "runs", "baseline");
    const moduleOutput = resolveTestRunPath("diagnostics", "analyze_router_callback_flow_foundation", "runs", "module");
    fs.rmSync(root, { recursive: true, force: true });
    const repoSourceDir = path.join(repoRoot, "src", "main", "ets");
    const moduleProjectDir = path.join(moduleRoot, "project", "router_callback_foundation", "modules");
    writeText(path.join(repoSourceDir, "EntryAbility.ets"), [
        "import { UIAbility } from '@kit.AbilityKit';",
        "",
        "function RegisterRoute(_name: string, _callback: (param: string) => void): void {}",
        "function PushRoute(_name: string, _param: string): void {}",
        "function TriggerRoute(_name: string): void {}",
        "function Sink(v: string): void {}",
        "",
        "export default class EntryAbility extends UIAbility {",
        "  onCreate(taint_src: string): void {",
        "    RegisterRoute(\"Detail\", (param: string) => {",
        "      Sink(param);",
        "    });",
        "    PushRoute(\"Detail\", taint_src);",
        "    TriggerRoute(\"Detail\");",
        "  }",
        "}",
        "",
    ].join("\n"));
    writeText(path.join(moduleRoot, "router_callback.rules.json"), stringifyRuleAssetFixture({
        id: "asset.rule.fixture.router_callback_foundation",
        sources: [
            {
                id: "source.fixture.router_callback_foundation",
                sourceKind: "entry_param",
                surface: { kind: "invoke", methodName: "onCreate" },
                target: "arg0"
            }
        ],
        sinks: [
            {
                id: "sink.fixture.router_callback_foundation",
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
    writeText(path.join(moduleProjectDir, "router_callback_bridge.ts"), [
        `import { defineModule } from "@arktaint/module";`,
        "",
        "export default defineModule({",
        "  id: \"fixture.router_callback_bridge\",",
        "  description: \"Bridge PushRoute(name, param) into RegisterRoute(name, callback) param0.\",",
        "  setup(ctx) {",
        "    const relay = ctx.bridge.keyedNodeRelay();",
        "    for (const call of ctx.scan.invokes({ methodName: \"RegisterRoute\" })) {",
        "      if (call.args().length < 2) continue;",
        "      const key = ctx.analysis.stringCandidates(call.arg(0))[0];",
        "      if (!key) continue;",
        "      relay.addTargets(key, call.callbackParamNodeIds(1, 0, { maxCandidates: 8 }));",
        "      ctx.deferred.imperativeFromInvoke(call, 1, {",
        "        reason: \"Fixture-RouterCallbackBinding\",",
        "      });",
        "    }",
        "    for (const call of ctx.scan.invokes({ methodName: \"PushRoute\" })) {",
        "      if (call.args().length < 2) continue;",
        "      const key = ctx.analysis.stringCandidates(call.arg(0))[0];",
        "      if (!key) continue;",
        "      relay.addSources(key, call.argNodeIds(1));",
        "    }",
        "    relay.materialize();",
        "    return {",
        "      onFact(event) {",
        "        return relay.emitPreserve(event, \"Fixture-RouterCallbackBridge\", { allowUnreachableTarget: true });",
        "      },",
        "    };",
        "  },",
        "});",
        "",
    ].join("\n"));
    const sharedArgs = [
        "--repo", repoRoot,
        "--sourceDir", "src/main/ets",
        "--project", path.join(moduleRoot, "router_callback.rules.json"),
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
        "--enable-model", "router_callback_foundation:modules",
        "--outputDir", moduleOutput,
    ]);
    const baseline = readAnalyzeSummary<AnalyzeSummary>(baselineOutput);
    const withModule = readAnalyzeSummary<AnalyzeSummary>(moduleOutput);
    assert(baseline.reportMode === "full", `expected baseline reportMode=full, got ${baseline.reportMode}`);
    assert(withModule.reportMode === "full", `expected module reportMode=full, got ${withModule.reportMode}`);
    assert(baseline.summary.totalFlows === 0, `baseline should have zero flows, got ${baseline.summary.totalFlows}`);
    assert(withModule.summary.totalFlows > 0, `module run should produce flows, got ${withModule.summary.totalFlows}`);
    const moduleEntry = withModule.entries.find(item => Array.isArray(item.postsolveResults) && item.postsolveResults.length > 0);
    assert(moduleEntry, "expected one entry with postsolveResults");
    console.log("PASS test_analyze_router_callback_flow_foundation");
    console.log(`baseline_total_flows=${baseline.summary.totalFlows}`);
    console.log(`module_total_flows=${withModule.summary.totalFlows}`);
}
main().catch((error) => {
    console.error("FAIL test_analyze_router_callback_flow_foundation");
    console.error(error);
    process.exit(1);
});
