import { readAnalyzeSummary, runAnalyzeCli } from "../helpers/AnalyzeCliRunner";
import { stringifyRuleAssetFixture } from "../helpers/RuleAssetFixtureFactory";
import { resolveTestRunDir, resolveTestRunPath } from "../helpers/TestWorkspaceLayout";
import * as fs from "fs";
import * as path from "path";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
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

function writeText(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("analyze", "safe_overwrite_suppressed");
    const caseRoot = resolveTestRunPath("analyze", "safe_overwrite_suppressed", "preferences_overwrite_safe");
    const repoRoot = path.join(caseRoot, "repo");
    const outputDir = path.join(caseRoot, "out");
    const sourceDir = path.join(repoRoot, "src", "main", "ets");
    const rulePath = path.join(caseRoot, "safe_overwrite.rules.json");

    fs.rmSync(root, { recursive: true, force: true });

    writeText(
        path.join(sourceDir, "EntryAbility.ets"),
        [
            "import { UIAbility } from '@kit.AbilityKit';",
            "",
            "class StorageBox {",
            "  putSync(_key: string, _value: string): void {}",
            "  getSync(_key: string): string { return \"\"; }",
            "}",
            "",
            "function Sink(v: string): void {}",
            "",
            "export default class EntryAbility extends UIAbility {",
            "  onCreate(taint_src: string): void {",
            "    const p = new StorageBox();",
            "    p.putSync(\"token\", taint_src);",
            "    p.putSync(\"token\", \"safe\");",
            "    Sink(p.getSync(\"token\"));",
            "  }",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        rulePath,
        stringifyRuleAssetFixture({
            id: "asset.rule.fixture.safe_overwrite",
            sources: [
                {
                    id: "source.fixture.safe_overwrite",
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
                    id: "sink.fixture.safe_overwrite",
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
                    id: "transfer.fixture.safe_overwrite.putsync_value_to_store",
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
                    id: "transfer.fixture.safe_overwrite.getsync_store_to_result",
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
        }),
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
    assert(!!entry, "expected one entry result");
    assert(entry.status === "ok", `expected entry status ok, got ${entry.status}`);
    assert(entry.seedCount > 0, `expected seedCount > 0, got ${entry.seedCount}`);

    const postsolveResults = entry.postsolveResults || [];
    const suppressed = postsolveResults.filter(item => item.judgement.kind === "Refuted-Strong");
    assert(postsolveResults.length > 0, "expected postsolveResults to contain at least one flow");
    assert(suppressed.length > 0, "expected one Refuted-Strong postsolve result");
    assert(
        suppressed[0].evidenceSummary.evidenceKinds.includes("safe_overwrite"),
        `expected evidenceKinds to include safe_overwrite, got ${JSON.stringify(suppressed[0].evidenceSummary.evidenceKinds)}`,
    );
    assert(suppressed[0].paths.length > 0, "expected safe_overwrite flow to retain path details");
    assert(
        suppressed[0].paths.every(pathItem => pathItem.judgement.kind === "Refuted-Strong"),
        `expected all path judgements to be Refuted-Strong, got ${JSON.stringify(suppressed[0].paths.map(item => item.judgement.kind))}`,
    );
    assert(
        suppressed[0].paths.some(pathItem => pathItem.evidence.some(evidence => evidence.kind === "safe_overwrite")),
        "expected path evidence to include safe_overwrite",
    );
    const materialized = entry.materializedTaintFlows || [];
    assert(
        materialized.some((item: any) => item?.sinkFactId === suppressed[0].flow.sinkFactId && item?.judgement === "Refuted-Strong"),
        `expected suppressed sinkFactId ${suppressed[0].flow.sinkFactId || "<empty>"} to be present with Refuted-Strong materialized judgement`,
    );

    console.log("PASS test_analyze_safe_overwrite_suppressed");
    console.log(`root=${root}`);
    console.log(`surviving_total_flows=${report.summary.totalFlows}`);
    console.log(`refuted_strong_count=${suppressed.length}`);
    console.log(`primary_reason=${suppressed[0].evidenceSummary.primaryReason || ""}`);
}

main().catch(error => {
    console.error("FAIL test_analyze_safe_overwrite_suppressed");
    console.error(error);
    process.exit(1);
});
