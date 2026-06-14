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
        flowRuleTraces?: Array<{
            sourceRuleId: string;
            sinkRuleId: string;
        }>;
    }>;
}

function hasSink(summary: AnalyzeSummary, sinkRuleId: string): boolean {
    return (summary.entries || []).some(entry =>
        (entry.flowRuleTraces || []).some(trace => trace.sinkRuleId === sinkRuleId),
    );
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("analyze", "returned_object_field");
    const repoRoot = resolveTestRunPath("analyze", "returned_object_field", "fixtures", "repo");
    const rulePath = resolveTestRunPath("analyze", "returned_object_field", "fixtures", "rules.json");
    const outputDir = resolveTestRunPath("analyze", "returned_object_field", "runs", "baseline");
    fs.rmSync(root, { recursive: true, force: true });

    const repoSourceDir = path.join(repoRoot, "src", "main", "ets");
    writeText(
        path.join(repoSourceDir, "EntryAbility.ets"),
        [
            "import { UIAbility } from '@kit.AbilityKit';",
            "",
            "class HeaderBag {",
            "  Authorization: string = '';",
            "  Role: string = '';",
            "}",
            "",
            "function Base64Source(): string {",
            "  return 'secret';",
            "}",
            "",
            "function buildHeaders(): HeaderBag {",
            "  const base64: string = Base64Source();",
            "  return {",
            "    'Authorization': `Basic ${base64}`,",
            "    'Role': 'clean',",
            "  };",
            "}",
            "",
            "function SinkAuthorization(_value: string): void {}",
            "function SinkRole(_value: string): void {}",
            "",
            "export default class EntryAbility extends UIAbility {",
            "  onCreate(): void {",
            "    const headers = buildHeaders();",
            "    SinkAuthorization(headers.Authorization);",
            "    SinkRole(headers.Role);",
            "  }",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        rulePath,
        stringifyRuleAssetFixture({
            id: "asset.rule.fixture.returned_object_field",
            sources: [
                {
                    id: "source.fixture.returned_object_field.base64",
                    sourceKind: "call_return",
                    match: {
                        kind: "method_name_equals",
                        value: "Base64Source",
                    },
                    target: "result",
                },
            ],
            sinks: [
                {
                    id: "sink.fixture.returned_object_field.authorization",
                    match: {
                        kind: "method_name_equals",
                        value: "SinkAuthorization",
                    },
                    target: "arg0",
                },
                {
                    id: "sink.fixture.returned_object_field.role",
                    match: {
                        kind: "method_name_equals",
                        value: "SinkRole",
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
        "--sourceDir", "src/main/ets",
        "--project", rulePath,
        "--reportMode", "full",
        "--no-incremental",
        "--k", "1",
        "--outputDir", outputDir,
    ]);

    const summary = readAnalyzeSummary<AnalyzeSummary>(outputDir);
    assert(
        hasSink(summary, "sink.fixture.returned_object_field.authorization"),
        "returned Authorization field should be tainted by Base64Source",
    );
    assert(
        !hasSink(summary, "sink.fixture.returned_object_field.role"),
        "sibling Role field must remain clean",
    );
    assert(summary.summary.totalFlows > 0, "expected at least one returned object field flow");

    console.log("PASS test_analyze_returned_object_field");
    console.log(`total_flows=${summary.summary.totalFlows}`);
    console.log(`authorization_detected=${hasSink(summary, "sink.fixture.returned_object_field.authorization")}`);
    console.log(`role_detected=${hasSink(summary, "sink.fixture.returned_object_field.role")}`);
}

main().catch(error => {
    console.error("FAIL test_analyze_returned_object_field");
    console.error(error);
    process.exit(1);
});
