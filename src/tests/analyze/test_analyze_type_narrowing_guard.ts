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

interface AnalyzeReport {
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
        materializedTaintFlows?: Array<{
            sinkFactId: string;
            judgement?: string;
            paths: Array<{
                factIds: string[];
                truncated?: boolean;
                judgement?: string;
                evidenceKinds?: string[];
            }>;
        }>;
        postsolveResults?: Array<{
            judgement: {
                kind: string;
            };
        }>;
    }>;
}

interface CaseSpec {
    name: string;
    bodyLines: string[];
    expectedTotalFlows: number;
}

function runCase(caseRoot: string, spec: CaseSpec): AnalyzeReport {
    const repoRoot = path.join(caseRoot, "repo");
    const outputDir = path.join(caseRoot, "out");
    const sourceDir = path.join(repoRoot, "src", "main", "ets");
    const rulePath = path.join(caseRoot, "type_narrowing_guard.rules.json");

    fs.rmSync(caseRoot, { recursive: true, force: true });

    writeText(
        path.join(sourceDir, "EntryAbility.ets"),
        [
            "import { UIAbility } from '@kit.AbilityKit';",
            "",
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "",
            "function UnknownValue(): any {",
            "  return globalThis;",
            "}",
            "",
            "function Sink(v: string): void {}",
            "",
            "function Safe(): void {}",
            "",
            "export default class EntryAbility extends UIAbility {",
            "  onCreate(): void {",
            "    const source = Source();",
            ...spec.bodyLines.map(line => `    ${line}`),
            "  }",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        rulePath,
        stringifyRuleAssetFixture({
            id: "asset.rule.fixture.type_narrowing_guard",
            sources: [
                {
                    id: "source.fixture.type_narrowing_guard",
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
                    id: "sink.fixture.type_narrowing_guard",
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

    return readAnalyzeSummary<AnalyzeReport>(outputDir);
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("analyze", "type_narrowing_guard");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });

    const cases: CaseSpec[] = [
        {
            name: "true_branch_dead",
            expectedTotalFlows: 0,
            bodyLines: [
                "const y = \"abc\";",
                "if (typeof y === \"number\") {",
                "  Sink(source);",
                "}",
            ],
        },
        {
            name: "false_branch_dead",
            expectedTotalFlows: 0,
            bodyLines: [
                "const y = 1;",
                "if (typeof y === \"number\") {",
                "  Safe();",
                "} else {",
                "  Sink(source);",
                "}",
            ],
        },
        {
            name: "sink_independent_of_guard",
            expectedTotalFlows: 0,
            bodyLines: [
                "const y = \"abc\";",
                "const alias = source;",
                "if (typeof y === \"number\") {",
                "  Sink(alias);",
                "}",
            ],
        },
        {
            name: "union_true_branch_dead",
            expectedTotalFlows: 0,
            bodyLines: [
                "const y = true;",
                "if (typeof y === \"number\" || typeof y === \"string\") {",
                "  Sink(source);",
                "}",
            ],
        },
        {
            name: "true_branch_live",
            expectedTotalFlows: 1,
            bodyLines: [
                "const y = 1;",
                "if (typeof y === \"number\") {",
                "  Sink(source);",
                "}",
            ],
        },
        {
            name: "false_branch_live",
            expectedTotalFlows: 1,
            bodyLines: [
                "const y = \"abc\";",
                "if (typeof y === \"number\") {",
                "  Safe();",
                "} else {",
                "  Sink(source);",
                "}",
            ],
        },
        {
            name: "and_true_branch_live",
            expectedTotalFlows: 1,
            bodyLines: [
                "const y = 1;",
                "if (typeof y !== \"undefined\" && typeof y !== \"function\") {",
                "  Sink(source);",
                "}",
            ],
        },
        {
            name: "union_true_branch_live",
            expectedTotalFlows: 1,
            bodyLines: [
                "const y = \"abc\";",
                "if (typeof y === \"number\" || typeof y === \"string\") {",
                "  Sink(source);",
                "}",
            ],
        },
        {
            name: "and_true_branch_dead_by_left",
            expectedTotalFlows: 0,
            bodyLines: [
                "const y = undefined;",
                "if (typeof y !== \"undefined\" && typeof y !== \"function\") {",
                "  Sink(source);",
                "}",
            ],
        },
        {
            name: "and_true_branch_dead_by_right",
            expectedTotalFlows: 0,
            bodyLines: [
                "const y = undefined;",
                "if (typeof y !== \"function\" && typeof y !== \"undefined\") {",
                "  Sink(source);",
                "}",
            ],
        },
        {
            name: "and_true_branch_live_string",
            expectedTotalFlows: 1,
            bodyLines: [
                "const y = \"abc\";",
                "if (typeof y !== \"undefined\" && typeof y !== \"function\") {",
                "  Sink(source);",
                "}",
            ],
        },
        {
            name: "and_false_branch_live",
            expectedTotalFlows: 1,
            bodyLines: [
                "const y = undefined;",
                "if (typeof y !== \"undefined\" && typeof y !== \"function\") {",
                "  Safe();",
                "} else {",
                "  Sink(source);",
                "}",
            ],
        },
        {
            name: "unknown_type_live",
            expectedTotalFlows: 1,
            bodyLines: [
                "const y = UnknownValue();",
                "if (typeof y === \"number\") {",
                "  Sink(source);",
                "}",
            ],
        },
        {
            name: "guard_not_on_witness_path_live",
            expectedTotalFlows: 1,
            bodyLines: [
                "const y = \"abc\";",
                "if (typeof y === \"number\") {",
                "  Safe();",
                "}",
                "Sink(source);",
            ],
        },
        {
            name: "unsupported_multi_variable_typeof_live",
            expectedTotalFlows: 1,
            bodyLines: [
                "const y = \"abc\";",
                "const z = true;",
                "if (typeof y === \"number\" || typeof z === \"string\") {",
                "  Sink(source);",
                "}",
            ],
        },
    ];

    for (const spec of cases) {
        const caseRoot = resolveTestRunPath("analyze", "type_narrowing_guard", spec.name);
        const report = runCase(caseRoot, spec);
        const entry = report.entries.find(item => item.entryName === "@arkMain") || report.entries[0];

        assert(report.reportMode === "full", `expected reportMode=full for ${spec.name}, got ${report.reportMode}`);
        assert(report.summary.withSeeds > 0, `expected withSeeds > 0 for ${spec.name}, got ${report.summary.withSeeds}`);
        assert(
            report.summary.totalFlows === spec.expectedTotalFlows,
            `expected totalFlows=${spec.expectedTotalFlows} for ${spec.name}, got ${report.summary.totalFlows}`,
        );
        assert(!!entry, `expected an entry result for ${spec.name}`);
        assert(entry.status === "ok", `expected ok entry status for ${spec.name}, got ${entry.status}`);
        assert(entry.seedCount > 0, `expected seedCount > 0 for ${spec.name}, got ${entry.seedCount}`);
        assert(
            entry.flowCount === spec.expectedTotalFlows,
            `expected flowCount=${spec.expectedTotalFlows} for ${spec.name}, got ${entry.flowCount}`,
        );
        if (spec.expectedTotalFlows === 0) {
            if ((entry.postsolveResults || []).length > 0) {
                assert(
                    Array.isArray(entry.materializedTaintFlows) && entry.materializedTaintFlows.length > 0,
                    `expected refuted materialized path details for ${spec.name}`,
                );
            }
        } else {
            assert(
                Array.isArray(entry.materializedTaintFlows) && entry.materializedTaintFlows.length > 0,
                `expected materialized flows for ${spec.name}`,
            );
            assert(
                entry.materializedTaintFlows!.some(item => (item.paths || []).length > 0),
                `expected at least one materialized witness path for ${spec.name}`,
            );
        }

        console.log(`PASS ${spec.name}`);
    }

    console.log("PASS test_analyze_type_narrowing_guard");
}

main().catch(error => {
    console.error("FAIL test_analyze_type_narrowing_guard");
    console.error(error);
    process.exit(1);
});
