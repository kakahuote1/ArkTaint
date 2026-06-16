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
            sinkRuleId: string;
        }>;
        worklistProfile?: {
            byReason?: Array<{
                reason: string;
                attempts: number;
                successes: number;
                dedupDrops: number;
            }>;
        };
    }>;
}

function hasSink(summary: AnalyzeSummary, sinkRuleId: string): boolean {
    return (summary.entries || []).some(entry =>
        (entry.flowRuleTraces || []).some(trace => trace.sinkRuleId === sinkRuleId),
    );
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("precision", "analyze_unresolved_this_field_load_scope");
    const repoRoot = resolveTestRunPath("precision", "analyze_unresolved_this_field_load_scope", "fixtures", "repo");
    const rulePath = resolveTestRunPath("precision", "analyze_unresolved_this_field_load_scope", "fixtures", "rules.json");
    const outputDir = resolveTestRunPath("precision", "analyze_unresolved_this_field_load_scope", "runs", "baseline");
    fs.rmSync(root, { recursive: true, force: true });

    const repoSourceDir = path.join(repoRoot, "src", "main", "ets");
    writeText(
        path.join(repoSourceDir, "EntryAbility.ets"),
        [
            "import { UIAbility } from '@kit.AbilityKit';",
            "",
            "function Source(): string {",
            "  return 'tainted-token';",
            "}",
            "",
            "function SinkToken(_value: string): void {}",
            "function SinkRole(_value: string): void {}",
            "",
            "export default class EntryAbility extends UIAbility {",
            "  private token: string = '';",
            "  private role: string = 'user';",
            "",
            "  onCreate(): void {",
            "    this.token = Source();",
            "    this.emitToken();",
            "    this.emitTokenAgain();",
            "    this.emitRole();",
            "  }",
            "",
            "  private emitToken(): void {",
            "    const tokenValue = this.token;",
            "    SinkToken(tokenValue);",
            "  }",
            "",
            "  private emitTokenAgain(): void {",
            "    const tokenValue = this.token;",
            "    SinkToken(tokenValue);",
            "  }",
            "",
            "  private emitRole(): void {",
            "    const roleValue = this.role;",
            "    SinkRole(roleValue);",
            "  }",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        rulePath,
        stringifyRuleAssetFixture({
            id: "asset.rule.fixture.unresolved_this_field_load_scope",
            sources: [
                {
                    id: "source.fixture.unresolved_this_field_load_scope",
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
                    id: "sink.fixture.unresolved_this_field_load_scope.token",
                    match: {
                        kind: "method_name_equals",
                        value: "SinkToken",
                    },
                    target: "arg0",
                },
                {
                    id: "sink.fixture.unresolved_this_field_load_scope.role",
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
    const tokenSink = "sink.fixture.unresolved_this_field_load_scope.token";
    const roleSink = "sink.fixture.unresolved_this_field_load_scope.role";

    assert(summary.summary.totalFlows > 0, "expected at least one this.token flow");
    assert(hasSink(summary, tokenSink), "expected this.token source to reach token sink");
    assert(!hasSink(summary, roleSink), "this.token source must not taint sibling this.role load");

    console.log("PASS test_analyze_unresolved_this_field_load_scope");
    console.log(`total_flows=${summary.summary.totalFlows}`);
    console.log(`token_detected=${hasSink(summary, tokenSink)}`);
    console.log(`role_detected=${hasSink(summary, roleSink)}`);
}

main().catch((error) => {
    console.error("FAIL test_analyze_unresolved_this_field_load_scope");
    console.error(error);
    process.exit(1);
});
