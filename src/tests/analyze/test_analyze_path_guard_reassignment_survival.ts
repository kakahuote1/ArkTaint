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
        postsolveResults?: Array<{
            paths: Array<{
                evidence: Array<{
                    kind: string;
                }>;
                judgement: {
                    kind: string;
                };
            }>;
            evidenceSummary: {
                evidenceKinds: string[];
            };
            judgement: {
                kind: string;
                primaryReason?: string;
            };
        }>;
        materializedTaintFlows?: Array<{
            judgement?: string;
            evidenceKinds?: string[];
            paths: Array<{
                judgement?: string;
                evidenceKinds?: string[];
            }>;
        }>;
    }>;
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("diagnostics", "analyze_path_guard_reassignment_survival");
    const repoRoot = resolveTestRunPath("diagnostics", "analyze_path_guard_reassignment_survival", "fixtures", "repo");
    const moduleRoot = resolveTestRunPath("diagnostics", "analyze_path_guard_reassignment_survival", "fixtures", "module_root");
    const outputDir = resolveTestRunPath("diagnostics", "analyze_path_guard_reassignment_survival", "runs", "module");
    fs.rmSync(root, { recursive: true, force: true });

    const repoSourceDir = path.join(repoRoot, "src", "main", "ets");
    const moduleProjectDir = path.join(moduleRoot, "project", "path_guard_reassignment_survival", "modules");

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
            "    let key = \"token\";",
            "    const box = new Vault();",
            "    const source = Source();",
            "    if (key === \"token\") {",
            "      const branchValue = source;",
            "      Store(box, branchValue);",
            "    }",
            "    key = \"user\";",
            "    if (key !== \"token\") {",
            "      Sink(box.saved);",
            "    }",
            "  }",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(moduleRoot, "path_guard_reassignment_survival.rules.json"),
        JSON.stringify({
            schemaVersion: "2.0",
            sources: [
                {
                    id: "source.fixture.path_guard_reassignment_survival",
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
                    id: "sink.fixture.path_guard_reassignment_survival",
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
        path.join(moduleProjectDir, "path_guard_reassignment_survival_bridge.ts"),
        [
            "import { defineModule } from \"@arktaint/module\";",
            "",
            "export default defineModule({",
            "  id: \"fixture.path_guard_reassignment_survival_bridge\",",
            "  description: \"Bridge Store(value) into box.saved for path-guard reassignment testing.\",",
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
            "          emissions.push(...event.emit.toValueField(target, [\"saved\"], \"Fixture-PathGuardReassignmentSurvival\"));",
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
        "--project", path.join(moduleRoot, "path_guard_reassignment_survival.rules.json"),
        "--model-root", moduleRoot,
        "--enable-model", "path_guard_reassignment_survival:modules",
        "--reportMode", "full",
        "--no-incremental",
        "--k", "1",
        "--outputDir", outputDir,
    ]);

    const report = readAnalyzeSummary<AnalyzeSummary>(outputDir);
    assert(report.reportMode === "full", `expected reportMode=full, got ${report.reportMode}`);
    assert(report.summary.totalFlows === 1, `expected surviving totalFlows=1, got ${report.summary.totalFlows}`);

    const entry = (report.entries || []).find(item =>
        Array.isArray(item.postsolveResults) && item.postsolveResults.length > 0,
    );
    assert(entry, "expected one entry with postsolveResults");
    const result = entry!.postsolveResults![0];
    assert(
        result.judgement.kind !== "Refuted-Strong",
        `expected reassignment to prevent strong refutation, got ${result.judgement.kind}`,
    );
    assert(
        !result.evidenceSummary.evidenceKinds.includes("path_guard"),
        `expected no path_guard evidence after reassignment, got ${JSON.stringify(result.evidenceSummary.evidenceKinds)}`,
    );
    assert(
        result.paths.every(pathItem => !pathItem.evidence.some(evidence => evidence.kind === "path_guard")),
        "expected no path-level path_guard evidence after reassignment",
    );

    console.log("PASS test_analyze_path_guard_reassignment_survival");
    console.log(`surviving_total_flows=${report.summary.totalFlows}`);
    console.log(`flow_judgement=${result.judgement.kind}`);
}

main().catch((error) => {
    console.error("FAIL test_analyze_path_guard_reassignment_survival");
    console.error(error);
    process.exit(1);
});
