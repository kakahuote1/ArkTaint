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
        flowCount: number;
        flowRuleTraces?: Array<{
            sourceRuleId: string;
            sinkRuleId: string;
            sinkFieldPath?: string[];
        }>;
    }>;
}
function hasSink(summary: AnalyzeSummary, sinkRuleId: string): boolean {
    return (summary.entries || []).some(entry => (entry.flowRuleTraces || []).some(trace => trace.sinkRuleId === sinkRuleId));
}
function hasSinkField(summary: AnalyzeSummary, sinkRuleId: string, fieldName: string): boolean {
    return (summary.entries || []).some(entry => (entry.flowRuleTraces || []).some(trace => trace.sinkRuleId === sinkRuleId
        && Array.isArray(trace.sinkFieldPath)
        && trace.sinkFieldPath.includes(fieldName)));
}
async function main(): Promise<void> {
    const root = resolveTestRunDir("precision", "analyze_object_container_sibling_field_precision");
    const repoRoot = resolveTestRunPath("precision", "analyze_object_container_sibling_field_precision", "fixtures", "repo");
    const rulePath = resolveTestRunPath("precision", "analyze_object_container_sibling_field_precision", "fixtures", "rules.json");
    const outputDir = resolveTestRunPath("precision", "analyze_object_container_sibling_field_precision", "runs", "baseline");
    fs.rmSync(root, { recursive: true, force: true });
    const repoSourceDir = path.join(repoRoot, "src", "main", "ets");
    writeText(path.join(repoSourceDir, "EntryAbility.ets"), [
        "import { UIAbility } from '@kit.AbilityKit';",
        "",
        "function Source(): string {",
        "  return 'tainted-content';",
        "}",
        "",
        "class Message {",
        "  content: string;",
        "  role: string;",
        "  timestamp: number;",
        "",
        "  constructor(content: string) {",
        "    this.content = content;",
        "    this.role = 'user';",
        "    this.timestamp = 1;",
        "  }",
        "}",
        "",
        "class RdbStore {",
        "  insert(_table: string, _values: any): void {}",
        "}",
        "",
        "class Database {",
        "  private rdb: RdbStore = new RdbStore();",
        "",
        "  insertMessage(saved: Message): void {",
        "    const valueBucket = {",
        "      content: saved.content,",
        "      role: saved.role,",
        "      timestamp: saved.timestamp,",
        "    };",
        "    this.rdb.insert('messages', valueBucket);",
        "  }",
        "}",
        "",
        "export default class EntryAbility extends UIAbility {",
        "  private database: Database = new Database();",
        "",
        "  onCreate(): void {",
        "    const message = new Message(Source());",
        "    this.database.insertMessage(message);",
        "  }",
        "}",
        "",
    ].join("\n"));
    writeText(rulePath, stringifyRuleAssetFixture({
        id: "asset.rule.fixture.object_container_sibling_fields",
        sources: [
            {
                id: "source.fixture.object_container_sibling_fields",
                sourceKind: "call_return",
                surface: {
                    kind: "invoke",
                    methodName: "Source",
                    scope: {
                        file: { mode: "equals", value: "EntryAbility.ets" },
                    }
                },
                target: "result"
            }
        ],
        sinks: [
            {
                id: "sink.fixture.object_container_sibling_fields.value_bucket",
                surface: {
                    kind: "invoke",
                    methodName: "insert",
                    scope: {
                        file: { mode: "equals", value: "EntryAbility.ets" },
                    }
                },
                target: "arg1"
            }
        ],
        sanitizers: [],
        transfers: []
    }));
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
    const valueBucketSink = "sink.fixture.object_container_sibling_fields.value_bucket";
    assert(summary.summary.totalFlows > 0, "expected at least one content flow");
    assert(hasSink(summary, valueBucketSink), "expected source content to reach value-bucket sink");
    assert(hasSinkField(summary, valueBucketSink, "content"), "expected source content to reach content field");
    assert(!hasSinkField(summary, valueBucketSink, "role"), "source content must not taint sibling role field");
    assert(!hasSinkField(summary, valueBucketSink, "timestamp"), "source content must not taint sibling timestamp field");
    console.log("PASS test_analyze_object_container_sibling_field_precision");
    console.log(`total_flows=${summary.summary.totalFlows}`);
    console.log(`content_detected=${hasSinkField(summary, valueBucketSink, "content")}`);
    console.log(`role_detected=${hasSinkField(summary, valueBucketSink, "role")}`);
    console.log(`timestamp_detected=${hasSinkField(summary, valueBucketSink, "timestamp")}`);
}
main().catch((error) => {
    console.error("FAIL test_analyze_object_container_sibling_field_precision");
    console.error(error);
    process.exit(1);
});
