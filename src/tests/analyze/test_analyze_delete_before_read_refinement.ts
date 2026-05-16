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
    const root = resolveTestRunDir("analyze", "delete_before_read_refinement");
    const caseRoot = resolveTestRunPath("analyze", "delete_before_read_refinement", "preferences_delete_then_read");
    const repoRoot = path.join(caseRoot, "repo");
    const outputDir = path.join(caseRoot, "out");
    const sourceDir = path.join(repoRoot, "src", "main", "ets");
    const rulePath = path.join(caseRoot, "delete_before_read.rules.json");

    fs.rmSync(root, { recursive: true, force: true });

    writeText(
        path.join(sourceDir, "EntryAbility.ets"),
        [
            "import { UIAbility } from '@kit.AbilityKit';",
            "",
            "class KeyStorage {",
            "  setItem(_key: string, _value: string): void {}",
            "  deleteItem(_key: string): void {}",
            "  getItem(_key: string): string { return \"\"; }",
            "}",
            "",
            "function Sink(_v: string): void {}",
            "",
            "export default class EntryAbility extends UIAbility {",
            "  onCreate(taint_src: string): void {",
            "    const p = new KeyStorage();",
            "    p.setItem(\"token\", taint_src);",
            "    p.deleteItem(\"token\");",
            "    Sink(p.getItem(\"token\"));",
            "    p.deleteItem(\"live\");",
            "    p.setItem(\"live\", taint_src);",
            "    Sink(p.getItem(\"live\"));",
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
                id: "source.fixture.delete_before_read",
                sourceKind: "entry_param",
                match: { kind: "local_name_regex", value: "^taint_src$" },
                target: "arg0",
            }],
            sinks: [{
                id: "sink.fixture.delete_before_read",
                match: { kind: "method_name_equals", value: "Sink" },
                target: "arg0",
            }],
            sanitizers: [],
            transfers: [
                {
                    id: "transfer.fixture.preferences.put_value_to_store",
                    match: { kind: "method_name_equals", value: "setItem", invokeKind: "instance", argCount: 2, typeHint: "KeyStorage" },
                    from: "arg1",
                    to: "base",
                },
                {
                    id: "transfer.fixture.preferences.get_store_to_result",
                    match: { kind: "method_name_equals", value: "getItem", invokeKind: "instance", argCount: 1, typeHint: "KeyStorage" },
                    from: "base",
                    to: "result",
                },
            ],
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
    assert(report.summary.totalFlows === 1, `expected one live put-after-delete flow, got ${report.summary.totalFlows}`);

    const results = entry.postsolveResults || [];
    const refuted = results.find(item => item.evidenceSummary.evidenceKinds.includes("delete_before_read"));
    assert(refuted, `expected delete_before_read evidence, got ${JSON.stringify(results.map(item => item.evidenceSummary.evidenceKinds))}`);
    assert(refuted!.judgement.kind === "Refuted-Strong", `expected delete-before-read flow refuted, got ${refuted!.judgement.kind}`);
    assert(results.some(item => item.judgement.kind !== "Refuted-Strong"), "expected put-after-delete flow to survive");

    console.log("PASS test_analyze_delete_before_read_refinement");
    console.log(`surviving_total_flows=${report.summary.totalFlows}`);
    console.log(`postsolve_results=${results.length}`);
}

main().catch(error => {
    console.error("FAIL test_analyze_delete_before_read_refinement");
    console.error(error);
    process.exit(1);
});
