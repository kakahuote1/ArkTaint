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
    const root = resolveTestRunDir("analyze", "project_network_wrapper_asset");
    const repoRoot = resolveTestRunPath("analyze", "project_network_wrapper_asset", "fixtures", "repo");
    const sourceRulePath = resolveTestRunPath("analyze", "project_network_wrapper_asset", "fixtures", "source.rules.json");
    const outputDir = resolveTestRunPath("analyze", "project_network_wrapper_asset", "runs", "with_project_asset");
    fs.rmSync(root, { recursive: true, force: true });

    const etsRoot = path.join(repoRoot, "entry", "src", "main", "ets");
    writeText(
        path.join(etsRoot, "services", "NetworkManagerV2.ets"),
        [
            "export class NetworkManagerV2 {",
            "  sendStreamChatRequestV2(apiUrl: string, apiKey: string, model: string, messages: string, config?: any): void {}",
            "  async sendChatRequest(apiUrl: string, apiKey: string, modelName: string, messages: string): Promise<string> {",
            "    return '';",
            "  }",
            "}",
            "",
        ].join("\n"),
    );
    writeText(
        path.join(etsRoot, "services", "search", "SearchService.ets"),
        [
            "export class SearchService {",
            "  async makeRequest(url: string, method: string, headers?: any, body?: string, timeout?: number): Promise<string> {",
            "    return '';",
            "  }",
            "}",
            "",
        ].join("\n"),
    );
    writeText(
        path.join(etsRoot, "entryability", "EntryAbility.ets"),
        [
            "import { NetworkManagerV2 } from '../services/NetworkManagerV2';",
            "import { SearchService } from '../services/search/SearchService';",
            "",
            "class UIAbility {",
            "  onCreate(): void {}",
            "}",
            "",
            "function Secret(): string {",
            "  return 'secret';",
            "}",
            "",
            "export default class EntryAbility extends UIAbility {",
            "  onCreate(): void {",
            "    const secret = Secret();",
            "    const network = new NetworkManagerV2();",
            "    const search = new SearchService();",
            "",
            "    network.sendStreamChatRequestV2('https://safe.example', 'safe-key', 'safe-model', secret, { ignored: secret });",
            "    network.sendChatRequest('https://safe.example', secret, 'safe-model', 'safe-message');",
            "    search.makeRequest('https://safe.example', secret, { Authorization: secret }, secret, 1000);",
            "    search.makeRequest('https://safe.example', secret, {}, 'safe-body', 1000);",
            "  }",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        sourceRulePath,
        stringifyRuleAssetFixture({
            id: "asset.rule.fixture.project_network_wrapper_source",
            sources: [
                {
                    id: "source.fixture.project_network_wrapper.secret",
                    sourceKind: "call_return",
                    match: { kind: "method_name_equals", value: "Secret" },
                    target: "result",
                },
            ],
            sinks: [],
            sanitizers: [],
            transfers: [],
        }),
    );

    runAnalyzeCli([
        "--repo", repoRoot,
        "--sourceDir", "entry/src/main/ets",
        "--project", sourceRulePath,
        "--model-root", "src/models",
        "--enable-model", "clearchat",
        "--reportMode", "full",
        "--no-incremental",
        "--k", "1",
        "--outputDir", outputDir,
    ]);

    const summary = readAnalyzeSummary<AnalyzeSummary>(outputDir);
    assert(summary.summary.totalFlows > 0, "expected project network wrapper asset to produce flows");

    assert(
        hasSink(summary, "project.clearchat.NetworkManagerV2.sendStreamChatRequestV2.messages"),
        "tainted stream messages should hit the project wrapper body sink",
    );
    assert(
        hasSink(summary, "project.clearchat.NetworkManagerV2.sendChatRequest.apiKey"),
        "tainted API key should hit the project wrapper authorization sink",
    );
    assert(
        hasSink(summary, "project.clearchat.SearchService.makeRequest.headers"),
        "tainted headers should hit the project search wrapper header sink",
    );
    assert(
        hasSink(summary, "project.clearchat.SearchService.makeRequest.body"),
        "tainted body should hit the project search wrapper body sink",
    );
    assert(
        !hasSink(summary, "project.clearchat.NetworkManagerV2.sendStreamChatRequestV2.tools"),
        "taint in config.ignored must not satisfy the config.tools endpoint sink",
    );
    assert(
        !hasSink(summary, "project.clearchat.SearchService.makeRequest.url"),
        "taint in HTTP method argument must not be treated as the URL endpoint",
    );

    console.log("PASS test_analyze_project_network_wrapper_asset");
    console.log(`total_flows=${summary.summary.totalFlows}`);
}

main().catch(error => {
    console.error("FAIL test_analyze_project_network_wrapper_asset");
    console.error(error);
    process.exit(1);
});
