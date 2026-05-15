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
        withSeeds: number;
        totalFlows: number;
    };
    entries: Array<{
        entryName: string;
        status: string;
        seedCount: number;
        flowCount: number;
        materializedTaintFlows?: Array<unknown>;
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
            };
        }>;
    }>;
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("analyze", "suppressed_flows");
    const caseRoot = resolveTestRunPath("analyze", "suppressed_flows", "type_narrowing_guard_dead");
    const repoRoot = path.join(caseRoot, "repo");
    const outputDir = path.join(caseRoot, "out");
    const sourceDir = path.join(repoRoot, "src", "main", "ets");
    const rulePath = path.join(caseRoot, "suppressed_flows.rules.json");

    fs.rmSync(root, { recursive: true, force: true });

    writeText(
        path.join(sourceDir, "EntryAbility.ets"),
        [
            "import { UIAbility } from '@kit.AbilityKit';",
            "",
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "",
            "function Sink(v: string): void {}",
            "",
            "export default class EntryAbility extends UIAbility {",
            "  onCreate(): void {",
            "    const source = Source();",
            "    const y = \"abc\";",
            "    if (typeof y === \"number\") {",
            "      Sink(source);",
            "    }",
            "  }",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        rulePath,
        JSON.stringify({
            schemaVersion: "2.0",
            sources: [
                {
                    id: "source.fixture.suppressed_flows",
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
                    id: "sink.fixture.suppressed_flows",
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

    runAnalyzeCli([
        "--repo", repoRoot,
        "--sourceDir", ".",
        "--project", rulePath,
        "--kernelRule", "tests/rules/minimal.rules.json",
        "--reportMode", "full",
        "--no-incremental",
        "--k", "1",
        "--outputDir", outputDir,
    ]);

    const report = readAnalyzeSummary<AnalyzeSummary>(outputDir);
    const entry = report.entries.find(item => item.entryName === "@arkMain") || report.entries[0];

    assert(report.reportMode === "full", `expected reportMode=full, got ${report.reportMode}`);
    assert(report.summary.withSeeds > 0, `expected withSeeds > 0, got ${report.summary.withSeeds}`);
    assert(report.summary.totalFlows === 0, `expected surviving totalFlows=0, got ${report.summary.totalFlows}`);
    assert(!!entry, "expected one entry result");
    assert(entry.status === "ok", `expected entry status ok, got ${entry.status}`);
    assert(entry.seedCount > 0, `expected seedCount > 0, got ${entry.seedCount}`);
    assert(entry.flowCount === 0, `expected surviving flowCount=0, got ${entry.flowCount}`);
    assert(
        !entry.materializedTaintFlows || entry.materializedTaintFlows.length === 0,
        `expected no surviving materialized flows, got ${(entry.materializedTaintFlows || []).length}`,
    );

    const postsolveResults = entry.postsolveResults || [];
    const suppressed = postsolveResults.filter(item => item.judgement.kind === "Refuted-Strong");
    assert(postsolveResults.length > 0, "expected postsolveResults to contain at least one flow");
    assert(suppressed.length > 0, "expected one Refuted-Strong postsolve result");
    assert(suppressed[0].judgement.kind === "Refuted-Strong", `expected Refuted-Strong, got ${suppressed[0].judgement.kind}`);
    assert(
        suppressed[0].evidenceSummary.evidenceKinds.includes("type_narrowing_guard"),
        `expected evidenceKinds to include type_narrowing_guard, got ${JSON.stringify(suppressed[0].evidenceSummary.evidenceKinds)}`,
    );
    assert(suppressed[0].paths.length > 0, "expected suppressed flow to retain path details");
    assert(
        suppressed[0].paths.every(pathItem => pathItem.judgement.kind === "Refuted-Strong"),
        `expected all suppressed path judgements to be Refuted-Strong, got ${JSON.stringify(suppressed[0].paths.map(item => item.judgement.kind))}`,
    );
    assert(
        suppressed[0].paths.some(pathItem => pathItem.evidence.some(evidence => evidence.kind === "type_narrowing_guard")),
        "expected suppressed path evidence to include type_narrowing_guard",
    );

    console.log("PASS test_analyze_suppressed_flows");
    console.log(`refuted_strong_count=${suppressed.length}`);
    console.log(`refuted_strong_judgement=${suppressed[0].judgement.kind}`);
}

main().catch(error => {
    console.error("FAIL test_analyze_suppressed_flows");
    console.error(error);
    process.exit(1);
});
