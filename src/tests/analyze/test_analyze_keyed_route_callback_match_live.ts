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
    };
    entries: Array<{
        entryName: string;
        flowCount: number;
        materializedTaintFlows?: Array<{
            sinkFactId?: string;
            paths?: Array<{ factIds: string[] }>;
        }>;
        postsolveResults?: Array<{
            evidenceSummary: {
                evidenceKinds: string[];
            };
            judgement: {
                kind: string;
            };
        }>;
    }>;
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("diagnostics", "analyze_keyed_route_callback_match_live");
    const repoRoot = resolveTestRunPath("diagnostics", "analyze_keyed_route_callback_match_live", "fixtures", "repo");
    const moduleRoot = resolveTestRunPath("diagnostics", "analyze_keyed_route_callback_match_live", "fixtures", "module_root");
    const baselineOutput = resolveTestRunPath("diagnostics", "analyze_keyed_route_callback_match_live", "runs", "baseline");
    const moduleOutput = resolveTestRunPath("diagnostics", "analyze_keyed_route_callback_match_live", "runs", "module");
    fs.rmSync(root, { recursive: true, force: true });

    const repoSourceDir = path.join(repoRoot, "src", "main", "ets");
    const moduleProjectDir = path.join(moduleRoot, "project", "keyed_route_callback_match", "modules");

    writeText(
        path.join(repoSourceDir, "EntryAbility.ets"),
        [
            "import { UIAbility } from '@kit.AbilityKit';",
            "",
            "function RegisterRoute(_name: string, _callback: (param: string) => void): void {}",
            "function PushRoute(_name: string, _param: string): void {}",
            "function TriggerRoute(_name: string): void {}",
            "",
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
        ].join("\n"),
    );

    writeText(
        path.join(moduleRoot, "keyed_route.rules.json"),
        stringifyRuleAssetFixture({
            id: "asset.rule.fixture.keyed_route_callback_match",
            sources: [
                {
                    id: "source.fixture.keyed_route_callback_match",
                    sourceKind: "entry_param",
                    match: {
                        kind: "local_name_regex",
                        value: "^taint_src$",
                    },
                    target: "arg0",
                },
            ],
            sinks: [
                {
                    id: "sink.fixture.keyed_route_callback_match",
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
        path.join(moduleProjectDir, "keyed_route_bridge.ts"),
        [
            `import { defineModule } from "@arktaint/module";`,
            "",
            "export default defineModule({",
            "  id: \"fixture.keyed_route_callback_bridge\",",
            "  description: \"Bridge PushRoute(name, param) into RegisterRoute(name, callback) param0.\",",
            "  setup(ctx) {",
            "    const relay = ctx.bridge.nodeRelay();",
            "    const sourceNodeIds: number[] = [];",
            "    const targetNodeIds: number[] = [];",
            "    for (const call of ctx.scan.invokes({ methodName: \"RegisterRoute\", minArgs: 2 })) {",
            "      targetNodeIds.push(...call.callbackParamNodeIds(1, 0, { maxCandidates: 8 }));",
            "      ctx.deferred.imperativeFromInvoke(call, 1, { reason: \"Fixture-KeyedRouteBinding\" });",
            "    }",
            "    for (const call of ctx.scan.invokes({ methodName: \"PushRoute\", minArgs: 2 })) {",
            "      sourceNodeIds.push(...call.argNodeIds(1));",
            "    }",
            "    relay.connectMany(sourceNodeIds, targetNodeIds);",
            "    return {",
            "      onFact(event) {",
            "        return relay.emitPreserve(event, \"Fixture-KeyedRouteBridge\", { allowUnreachableTarget: true });",
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
        "--project", path.join(moduleRoot, "keyed_route.rules.json"),
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
        "--enable-model", "keyed_route_callback_match:modules",
        "--outputDir", moduleOutput,
    ]);

    const baseline = readAnalyzeSummary<AnalyzeSummary>(baselineOutput);
    const withModule = readAnalyzeSummary<AnalyzeSummary>(moduleOutput);

    assert(baseline.summary.totalFlows === 0, `baseline should have zero flows, got ${baseline.summary.totalFlows}`);
    assert(withModule.summary.totalFlows > 0, `module run should produce flows, got ${withModule.summary.totalFlows}`);

    const entry = withModule.entries.find(item =>
        Array.isArray(item.postsolveResults) && item.postsolveResults.length > 0,
    );
    assert(entry, "expected one entry with postsolveResults");
    assert(entry!.flowCount > 0, `expected flowCount > 0, got ${entry!.flowCount}`);
    assert(
        entry!.postsolveResults!.every(item => !item.evidenceSummary.evidenceKinds.includes("keyed_route_callback_mismatch")),
        `expected no keyed_route_callback_mismatch evidence, got ${JSON.stringify(entry!.postsolveResults!.map(item => item.evidenceSummary.evidenceKinds))}`,
    );
    assert(
        entry!.postsolveResults!.some(item => item.judgement.kind === "Unresolved" || item.judgement.kind === "Confirmed"),
        `expected one live postsolve result, got ${JSON.stringify(entry!.postsolveResults!.map(item => item.judgement.kind))}`,
    );
    assert((entry!.materializedTaintFlows || []).length > 0, "expected surviving materializedTaintFlows");

    console.log("PASS test_analyze_keyed_route_callback_match_live");
    console.log(`baseline_total_flows=${baseline.summary.totalFlows}`);
    console.log(`module_total_flows=${withModule.summary.totalFlows}`);
}

main().catch((error) => {
    console.error("FAIL test_analyze_keyed_route_callback_match_live");
    console.error(error);
    process.exit(1);
});
