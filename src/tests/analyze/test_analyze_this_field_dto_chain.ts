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
            sinkFieldPath?: string[];
        }>;
    }>;
}
function hasSinkField(summary: AnalyzeSummary, sinkRuleId: string, fieldName: string): boolean {
    return (summary.entries || []).some(entry => (entry.flowRuleTraces || []).some(trace => trace.sinkRuleId === sinkRuleId
        && Array.isArray(trace.sinkFieldPath)
        && trace.sinkFieldPath.includes(fieldName)));
}
async function main(): Promise<void> {
    const root = resolveTestRunDir("precision", "analyze_this_field_dto_chain");
    const repoRoot = resolveTestRunPath("precision", "analyze_this_field_dto_chain", "fixtures", "repo");
    const rulePath = resolveTestRunPath("precision", "analyze_this_field_dto_chain", "fixtures", "rules.json");
    const outputDir = resolveTestRunPath("precision", "analyze_this_field_dto_chain", "runs", "baseline");
    fs.rmSync(root, { recursive: true, force: true });
    const repoSourceDir = path.join(repoRoot, "src", "main", "ets");
    writeText(path.join(repoSourceDir, "EntryAbility.ets"), [
        "import { UIAbility } from '@kit.AbilityKit';",
        "",
        "function SourceAmount(): string {",
        "  return '100';",
        "}",
        "",
        "function SinkValueBucket(_bucket: any): void {}",
        "",
        "class AccountInfo {",
        "  amount: string = '';",
        "  role: string = '';",
        "}",
        "",
        "class AccountModel {",
        "  insert(info: AccountInfo): void {",
        "    const valueBucket = {",
        "      amount: info.amount,",
        "      role: info.role,",
        "    };",
        "    SinkValueBucket(valueBucket);",
        "  }",
        "}",
        "",
        "class AccountService {",
        "  private model: AccountModel = new AccountModel();",
        "",
        "  save(info: AccountInfo): void {",
        "    this.model.insert(info);",
        "  }",
        "}",
        "",
        "export default class EntryAbility extends UIAbility {",
        "  private accountInfo: AccountInfo = new AccountInfo();",
        "  private service: AccountService = new AccountService();",
        "",
        "  onCreate(): void {",
        "    this.accountInfo.amount = SourceAmount();",
        "    this.accountInfo.role = 'clean';",
        "    this.service.save(this.accountInfo);",
        "  }",
        "}",
        "",
    ].join("\n"));
    writeText(rulePath, stringifyRuleAssetFixture({
        id: "asset.rule.fixture.this_field_dto_chain",
        sources: [
            {
                id: "source.fixture.this_field_dto_chain.amount",
                sourceKind: "call_return",
                surface: {
                    kind: "invoke",
                    methodName: "SourceAmount",
                    scope: {
                        file: { mode: "equals", value: "EntryAbility.ets" },
                    }
                },
                target: "result"
            }
        ],
        sinks: [
            {
                id: "sink.fixture.this_field_dto_chain.value_bucket",
                surface: {
                    kind: "invoke",
                    methodName: "SinkValueBucket",
                    scope: {
                        file: { mode: "equals", value: "EntryAbility.ets" },
                    }
                },
                target: "arg0"
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
    const bucketSink = "sink.fixture.this_field_dto_chain.value_bucket";
    assert(summary.summary.totalFlows > 0, "expected this-field DTO chain to produce a flow");
    assert(hasSinkField(summary, bucketSink, "amount"), "source amount should reach valueBucket.amount");
    assert(!hasSinkField(summary, bucketSink, "role"), "source amount must not taint valueBucket.role");
    console.log("PASS test_analyze_this_field_dto_chain");
    console.log(`total_flows=${summary.summary.totalFlows}`);
    console.log(`amount_detected=${hasSinkField(summary, bucketSink, "amount")}`);
    console.log(`role_detected=${hasSinkField(summary, bucketSink, "role")}`);
}
main().catch((error) => {
    console.error("FAIL test_analyze_this_field_dto_chain");
    console.error(error);
    process.exit(1);
});
