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
        postsolveResults?: Array<{
            flow: {
                source: string;
                sinkText: string;
                sinkFactId?: string;
            };
            paths: Array<{
                factIds: string[];
                truncated?: boolean;
                judgement: {
                    kind: string;
                };
            }>;
            judgement: {
                kind: string;
                primaryReason?: string;
            };
        }>;
    }>;
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("diagnostics", "analyze_postsolve_path_judgement_divergence");
    const repoRoot = resolveTestRunPath("diagnostics", "analyze_postsolve_path_judgement_divergence", "fixtures", "repo");
    const moduleRoot = resolveTestRunPath("diagnostics", "analyze_postsolve_path_judgement_divergence", "fixtures", "module_root");
    const outputDir = resolveTestRunPath("diagnostics", "analyze_postsolve_path_judgement_divergence", "runs", "module");
    fs.rmSync(root, { recursive: true, force: true });

    const repoSourceDir = path.join(repoRoot, "src", "main", "ets");
    const moduleProjectDir = path.join(moduleRoot, "project", "path_judgement_divergence", "modules");

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
            "      const leftBranch = left;",
            "      Merge(box, leftBranch, SafeValue());",
            "    }",
            "    const rightBranch = right;",
            "    Merge(box, SafeValue(), rightBranch);",
            "    Sink(box.saved);",
            "  }",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(moduleRoot, "path_judgement_divergence.rules.json"),
        stringifyRuleAssetFixture({
            id: "asset.rule.fixture.path_judgement_divergence",
            sources: [
                {
                    id: "source.fixture.path_judgement_divergence",
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
                    id: "sink.fixture.path_judgement_divergence",
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
        path.join(moduleProjectDir, "path_judgement_divergence_bridge.ts"),
        [
            "import { defineModule } from \"@arktaint/module\";",
            "",
            "export default defineModule({",
            "  id: \"fixture.path_judgement_divergence_bridge\",",
            "  description: \"Bridge branch-local Merge arguments into box.saved.\",",
            "  setup(ctx) {",
            "    const mergeCalls = ctx.scan.invokes({ methodName: \"Merge\", minArgs: 3 });",
            "    return {",
            "      onFact(event) {",
            "        const localName = event.current.value?.getName?.();",
            "        if (localName !== \"leftBranch\" && localName !== \"rightBranch\") return;",
            "        const emissions = [];",
            "        for (const call of mergeCalls) {",
            "          const target = call.arg(0);",
            "          if (!target) continue;",
            "          const leftArgName = call.arg(1)?.getName?.();",
            "          const rightArgName = call.arg(2)?.getName?.();",
            "          if (localName === \"leftBranch\" && leftArgName === \"leftBranch\") {",
            "            emissions.push(...event.emit.toValueField(target, [\"saved\"], \"Fixture-PathJudgementLeft\"));",
            "          }",
            "          if (localName === \"rightBranch\" && rightArgName === \"rightBranch\") {",
            "            emissions.push(...event.emit.toValueField(target, [\"saved\"], \"Fixture-PathJudgementRight\"));",
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

    runAnalyzeCli([
        "--repo", repoRoot,
        "--sourceDir", "src/main/ets",
        "--project", path.join(moduleRoot, "path_judgement_divergence.rules.json"),
        "--model-root", moduleRoot,
        "--enable-model", "path_judgement_divergence:modules",
        "--reportMode", "full",
        "--no-incremental",
        "--k", "1",
        "--outputDir", outputDir,
    ]);

    const report = readAnalyzeSummary<AnalyzeSummary>(outputDir);
    assert(report.reportMode === "full", `expected reportMode=full, got ${report.reportMode}`);
    assert(report.summary.totalFlows === 1, `expected totalFlows=1, got ${report.summary.totalFlows}`);

    const entry = (report.entries || []).find(item =>
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

    console.log("PASS test_analyze_postsolve_path_judgement_divergence");
    console.log(`total_flows=${report.summary.totalFlows}`);
    console.log(`path_judgements=${pathJudgements.join(",")}`);
    console.log(`flow_judgement=${result.judgement.kind}`);
}

main().catch((error) => {
    console.error("FAIL test_analyze_postsolve_path_judgement_divergence");
    console.error(error);
    process.exit(1);
});
