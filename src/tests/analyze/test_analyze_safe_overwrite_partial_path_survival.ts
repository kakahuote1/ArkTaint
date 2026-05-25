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
        postsolveResults?: Array<{
            flow: {
                source: string;
                sinkText: string;
                sinkFactId?: string;
            };
            paths: Array<{
                factIds: string[];
                truncated?: boolean;
                evidence: Array<{
                    kind: string;
                }>;
                judgement: {
                    kind: string;
                };
            }>;
            evidenceSummary: {
                evidenceKinds: string[];
                primaryReason?: string;
            };
            judgement: {
                kind: string;
                primaryReason?: string;
            };
        }>;
    }>;
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("diagnostics", "analyze_safe_overwrite_partial_path_survival");
    const repoRoot = resolveTestRunPath("diagnostics", "analyze_safe_overwrite_partial_path_survival", "fixtures", "repo");
    const moduleRoot = resolveTestRunPath("diagnostics", "analyze_safe_overwrite_partial_path_survival", "fixtures", "module_root");
    const baselineOutput = resolveTestRunPath("diagnostics", "analyze_safe_overwrite_partial_path_survival", "runs", "baseline");
    const moduleOutput = resolveTestRunPath("diagnostics", "analyze_safe_overwrite_partial_path_survival", "runs", "module");
    fs.rmSync(root, { recursive: true, force: true });

    const repoSourceDir = path.join(repoRoot, "src", "main", "ets");
    const moduleProjectDir = path.join(moduleRoot, "project", "safe_overwrite_partial_path_survival", "modules");

    writeText(
        path.join(repoSourceDir, "EntryAbility.ets"),
        [
            "import { UIAbility } from '@kit.AbilityKit';",
            "",
            "class Vault {",
            "  saved: string = \"\";",
            "}",
            "",
            "class StorageBox {",
            "  putSync(_key: string, _value: string): void {}",
            "  getSync(_key: string): string { return \"\"; }",
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
            "    const leftStore = new StorageBox();",
            "    leftStore.putSync(\"token\", source);",
            "    leftStore.putSync(\"token\", \"safe\");",
            "    const leftValue = leftStore.getSync(\"token\");",
            "    const rightStore = new StorageBox();",
            "    rightStore.putSync(\"token\", source);",
            "    const rightValue = rightStore.getSync(\"token\");",
            "    Merge(box, leftValue, rightValue);",
            "    Sink(box.saved);",
            "  }",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(moduleRoot, "safe_overwrite_partial_path_survival.rules.json"),
        JSON.stringify({
            schemaVersion: "2.0",
            sources: [
                {
                    id: "source.fixture.safe_overwrite_partial_path_survival",
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
                    id: "sink.fixture.safe_overwrite_partial_path_survival",
                    match: {
                        kind: "method_name_equals",
                        value: "Sink",
                    },
                    target: "arg0",
                },
            ],
            sanitizers: [],
            transfers: [
                {
                    id: "transfer.fixture.safe_overwrite_partial_path_survival.putsync_value_to_store",
                    match: {
                        kind: "method_name_equals",
                        value: "putSync",
                        invokeKind: "instance",
                        argCount: 2,
                        typeHint: "StorageBox",
                    },
                    from: "arg1",
                    to: "base",
                },
                {
                    id: "transfer.fixture.safe_overwrite_partial_path_survival.getsync_store_to_result",
                    match: {
                        kind: "method_name_equals",
                        value: "getSync",
                        invokeKind: "instance",
                        argCount: 1,
                        typeHint: "StorageBox",
                    },
                    from: "base",
                    to: "result",
                },
            ],
        }, null, 2),
    );

    writeText(
        path.join(moduleProjectDir, "safe_overwrite_partial_path_survival_bridge.ts"),
        [
            "import { defineModule } from \"@arktaint/module\";",
            "",
            "export default defineModule({",
            "  id: \"fixture.safe_overwrite_partial_path_survival_bridge\",",
            "  description: \"Bridge Merge arguments into box.saved for safe-overwrite partial survival.\",",
            "  setup(ctx) {",
            "    const mergeCalls = ctx.scan.invokes({ methodName: \"Merge\", minArgs: 3 });",
            "    return {",
            "      onFact(event) {",
            "        const localName = event.current.value?.getName?.();",
            "        if (localName !== \"leftValue\" && localName !== \"rightValue\") return;",
            "        const emissions = [];",
            "        for (const call of mergeCalls) {",
            "          const target = call.arg(0);",
          "          if (!target) continue;",
            "          const leftArgName = call.arg(1)?.getName?.();",
            "          const rightArgName = call.arg(2)?.getName?.();",
            "          if (localName === \"leftValue\" && leftArgName === \"leftValue\") {",
            "            emissions.push(...event.emit.toValueField(target, [\"saved\"], \"Fixture-SafeOverwritePartialLeft\"));",
            "          }",
            "          if (localName === \"rightValue\" && rightArgName === \"rightValue\") {",
            "            emissions.push(...event.emit.toValueField(target, [\"saved\"], \"Fixture-SafeOverwritePartialRight\"));",
            "          }",
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
        "--project", path.join(moduleRoot, "safe_overwrite_partial_path_survival.rules.json"),
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
        "--enable-model", "safe_overwrite_partial_path_survival:modules",
        "--outputDir", moduleOutput,
    ]);

    const baseline = readAnalyzeSummary<AnalyzeSummary>(baselineOutput);
    const withModule = readAnalyzeSummary<AnalyzeSummary>(moduleOutput);

    assert(withModule.reportMode === "full", `expected reportMode=full, got ${withModule.reportMode}`);
    assert(baseline.summary.totalFlows === 0, `expected baseline without Merge bridge to contain no sink flows, got ${baseline.summary.totalFlows}`);
    assert(withModule.summary.totalFlows >= 1, `expected module run to retain surviving flows, got ${withModule.summary.totalFlows}`);

    const entry = (withModule.entries || []).find(item =>
        Array.isArray(item.postsolveResults) && item.postsolveResults.length > 0,
    );
    assert(entry, "expected one entry with postsolveResults");

    const result = entry!.postsolveResults![0];
    assert(result.paths.length >= 2, `expected at least two paths, got ${result.paths.length}`);

    const pathJudgements = result.paths.map(pathItem => pathItem.judgement.kind);
    assert(pathJudgements.includes("Refuted-Strong"), `expected one Refuted-Strong path, got ${JSON.stringify(pathJudgements)}`);
    assert(pathJudgements.includes("Unresolved"), `expected one Unresolved path, got ${JSON.stringify(pathJudgements)}`);
    assert(result.judgement.kind === "Unresolved", `expected flow judgement Unresolved, got ${result.judgement.kind}`);
    assert(
        result.judgement.primaryReason === "not_all_paths_refuted",
        `expected primaryReason=not_all_paths_refuted, got ${result.judgement.primaryReason}`,
    );
    assert(
        result.paths.some(pathItem =>
            pathItem.judgement.kind === "Refuted-Strong"
            && pathItem.evidence.some(evidence => evidence.kind === "safe_overwrite"),
        ),
        "expected one Refuted-Strong path with safe_overwrite evidence",
    );

    const materializedEntries = (withModule.entries || []).filter(item =>
        Array.isArray(item.materializedTaintFlows) && item.materializedTaintFlows.length > 0,
    );
    assert(materializedEntries.length >= 1, `expected at least one entry with surviving materialized flows, got ${materializedEntries.length}`);
    const materialized = materializedEntries.flatMap(item => item.materializedTaintFlows || []);
    assert(materialized.length >= 1, `expected at least one surviving materialized taint flow, got ${materialized.length}`);
    const survivingPathCount = materialized.flatMap(item => item.paths || []).length;
    assert(survivingPathCount >= 1, `expected at least one surviving path, got ${survivingPathCount}`);

    console.log("PASS test_analyze_safe_overwrite_partial_path_survival");
    console.log(`baseline_total_flows=${baseline.summary.totalFlows}`);
    console.log(`module_total_flows=${withModule.summary.totalFlows}`);
    console.log(`path_judgements=${pathJudgements.join(",")}`);
    console.log(`surviving_paths=${survivingPathCount}`);
}

main().catch((error) => {
    console.error("FAIL test_analyze_safe_overwrite_partial_path_survival");
    console.error(error);
    process.exit(1);
});
