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
        postsolveResults?: Array<{
            paths: Array<{
                status?: string;
                truncated?: boolean;
                evidence: Array<{
                    kind: string;
                    meta?: Record<string, unknown>;
                }>;
                judgement: {
                    kind: string;
                    primaryReason?: string;
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
        materializedTaintFlows?: Array<{
            status?: string;
            incompleteReasons?: string[];
            judgement?: string;
            evidenceKinds?: string[];
            paths: Array<{
                status?: string;
                truncated?: boolean;
                judgement?: string;
                evidenceKinds?: string[];
            }>;
        }>;
    }>;
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("diagnostics", "analyze_path_guard_literal_conflict");
    const repoRoot = resolveTestRunPath("diagnostics", "analyze_path_guard_literal_conflict", "fixtures", "repo");
    const moduleRoot = resolveTestRunPath("diagnostics", "analyze_path_guard_literal_conflict", "fixtures", "module_root");
    const outputDir = resolveTestRunPath("diagnostics", "analyze_path_guard_literal_conflict", "runs", "module");
    fs.rmSync(root, { recursive: true, force: true });

    const repoSourceDir = path.join(repoRoot, "src", "main", "ets");
    const moduleProjectDir = path.join(moduleRoot, "project", "path_guard_literal_conflict", "modules");

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
            "function Store(box: Vault, value: string): void {}",
            "",
            "function Sink(v: string): void {}",
            "",
            "export default class EntryAbility extends UIAbility {",
            "  onCreate(): void {",
            "    const key = \"token\";",
            "    const box = new Vault();",
            "    const source = Source();",
            "    if (key === \"token\") {",
            "      const branchValue = source;",
            "      Store(box, branchValue);",
            "    }",
            "    if (key !== \"token\") {",
            "      Sink(box.saved);",
            "    }",
            "  }",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(moduleRoot, "path_guard_literal_conflict.rules.json"),
        stringifyRuleAssetFixture({
            id: "asset.rule.fixture.path_guard_literal_conflict",
            sources: [
                {
                    id: "source.fixture.path_guard_literal_conflict",
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
                    id: "sink.fixture.path_guard_literal_conflict",
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
        path.join(moduleProjectDir, "path_guard_literal_conflict_bridge.ts"),
        [
            "import { defineModule } from \"@arktaint/module\";",
            "",
            "export default defineModule({",
            "  id: \"fixture.path_guard_literal_conflict_bridge\",",
            "  description: \"Bridge Store(value) into box.saved for path-guard testing.\",",
            "  setup(ctx) {",
            "    const storeCalls = ctx.scan.invokes({ methodName: \"Store\", minArgs: 2 });",
            "    return {",
            "      onFact(event) {",
            "        const localName = event.current.value?.getName?.();",
            "        if (localName !== \"branchValue\") return;",
            "        const emissions = [];",
            "        for (const call of storeCalls) {",
            "          const target = call.arg(0);",
            "          if (!target) continue;",
            "          const valueArgName = call.arg(1)?.getName?.();",
            "          if (valueArgName !== \"branchValue\") continue;",
            "          emissions.push(...event.emit.toValueField(target, [\"saved\"], \"Fixture-PathGuardLiteralConflict\"));",
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
        "--project", path.join(moduleRoot, "path_guard_literal_conflict.rules.json"),
        "--model-root", moduleRoot,
        "--enable-model", "path_guard_literal_conflict:modules",
        "--reportMode", "full",
        "--no-incremental",
        "--k", "1",
        "--outputDir", outputDir,
    ]);

    const report = readAnalyzeSummary<AnalyzeSummary>(outputDir);
    assert(report.reportMode === "full", `expected reportMode=full, got ${report.reportMode}`);
    assert(report.summary.totalFlows === 0, `expected surviving totalFlows=0, got ${report.summary.totalFlows}`);

    const entry = (report.entries || []).find(item =>
        Array.isArray(item.postsolveResults) && item.postsolveResults.length > 0,
    );
    assert(entry, "expected one entry with postsolveResults");
    const result = entry!.postsolveResults![0];
    assert(result.judgement.kind === "Refuted-Strong", `expected Refuted-Strong, got ${result.judgement.kind}`);
    assert(
        result.evidenceSummary.evidenceKinds.includes("path_guard"),
        `expected path_guard evidence, got ${JSON.stringify(result.evidenceSummary.evidenceKinds)}`,
    );
    assert(result.paths.length > 0, "expected at least one materialized path");
    assert(
        result.paths.every(item => item.status !== "incomplete" && !item.truncated),
        `expected complete paths, got ${JSON.stringify(result.paths.map(item => ({ status: item.status, truncated: item.truncated })))}`,
    );
    assert(
        result.paths.every(item => item.judgement.kind === "Refuted-Strong"),
        `expected all paths refuted, got ${JSON.stringify(result.paths.map(item => item.judgement.kind))}`,
    );
    assert(
        result.paths.some(item => item.evidence.some(evidence => evidence.kind === "path_guard")),
        "expected path_guard evidence on at least one path",
    );

    const materialized = (entry!.materializedTaintFlows || [])[0];
    assert(materialized, "expected materializedTaintFlows entry");
    assert(materialized.status === "complete", `expected materialized status complete, got ${materialized.status}`);
    assert(materialized.judgement === "Refuted-Strong", `expected materialized judgement Refuted-Strong, got ${materialized.judgement}`);
    assert(
        (materialized.evidenceKinds || []).includes("path_guard"),
        `expected materialized path_guard evidence, got ${JSON.stringify(materialized.evidenceKinds)}`,
    );

    console.log("PASS test_analyze_path_guard_literal_conflict");
    console.log(`path_count=${result.paths.length}`);
    console.log(`flow_judgement=${result.judgement.kind}`);
}

main().catch((error) => {
    console.error("FAIL test_analyze_path_guard_literal_conflict");
    console.error(error);
    process.exit(1);
});
