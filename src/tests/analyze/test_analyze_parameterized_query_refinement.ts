import { readAnalyzeSummary, runAnalyzeCli } from "../helpers/AnalyzeCliRunner";
import { resolveTestRunDir, resolveTestRunPath } from "../helpers/TestWorkspaceLayout";
import * as fs from "fs";
import * as path from "path";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

interface AnalyzeSummary {
    reportMode: "light" | "full";
    summary: { totalFlows: number; withSeeds: number };
    entries: Array<{
        entryName: string;
        status: string;
        flowCount: number;
        postsolveResults?: Array<{
            evidenceSummary: { evidenceKinds: string[]; primaryReason?: string };
            judgement: { kind: string };
            paths: Array<{ judgement: { kind: string }; evidence: Array<{ kind: string }> }>;
        }>;
    }>;
}

function writeText(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("analyze", "parameterized_query_refinement");
    const caseRoot = resolveTestRunPath("analyze", "parameterized_query_refinement", "rdb_parameterized");
    const repoRoot = path.join(caseRoot, "repo");
    const outputDir = path.join(caseRoot, "out");
    const sourceDir = path.join(repoRoot, "src", "main", "ets");
    const rulePath = path.join(caseRoot, "parameterized_query.rules.json");

    fs.rmSync(root, { recursive: true, force: true });

    writeText(
        path.join(sourceDir, "EntryAbility.ets"),
        [
            "import { UIAbility } from '@kit.AbilityKit';",
            "",
            "class RdbStore {",
            "  executeSql(_sql: string, _args: string): void {}",
            "}",
            "",
            "export default class EntryAbility extends UIAbility {",
            "  onCreate(taint_src: string): void {",
            "    const db = new RdbStore();",
            "    db.executeSql(\"select * from user where id=?\", taint_src);",
            "    const sql = \"select * from user where id=\" + taint_src;",
            "    db.executeSql(sql, \"safe\");",
            "  }",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        rulePath,
        JSON.stringify({
            schemaVersion: "2.0",
            sources: [{
                id: "source.fixture.parameterized_query",
                sourceKind: "entry_param",
                match: { kind: "local_name_regex", value: "^taint_src$" },
                target: "arg0",
            }],
            sinks: [
                {
                    id: "sink.fixture.executeSql.sql",
                    match: { kind: "method_name_equals", value: "executeSql" },
                    target: "arg0",
                },
                {
                    id: "sink.fixture.executeSql.bind",
                    match: { kind: "method_name_equals", value: "executeSql" },
                    target: "arg1",
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
    assert(report.summary.withSeeds > 0, "expected withSeeds > 0");
    assert(entry?.status === "ok", `expected ok entry, got ${entry?.status}`);
    assert(report.summary.totalFlows === 1, `expected one surviving SQL-template flow, got ${report.summary.totalFlows}`);

    const results = entry.postsolveResults || [];
    const refuted = results.find(item => item.evidenceSummary.evidenceKinds.includes("parameterized_query"));
    assert(refuted, `expected parameterized_query evidence, got ${JSON.stringify(results.map(item => item.evidenceSummary.evidenceKinds))}`);
    assert(refuted!.judgement.kind === "Refuted-Strong", `expected parameterized flow refuted, got ${refuted!.judgement.kind}`);
    assert(results.some(item => item.judgement.kind !== "Refuted-Strong"), "expected dynamic SQL-template flow to survive");

    console.log("PASS test_analyze_parameterized_query_refinement");
    console.log(`surviving_total_flows=${report.summary.totalFlows}`);
    console.log(`postsolve_results=${results.length}`);
}

main().catch(error => {
    console.error("FAIL test_analyze_parameterized_query_refinement");
    console.error(error);
    process.exit(1);
});
