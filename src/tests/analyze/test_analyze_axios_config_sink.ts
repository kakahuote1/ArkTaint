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
function hasTrace(summary: AnalyzeSummary, sourceRuleId: string, sinkRuleId: string): boolean {
    return (summary.entries || []).some(entry => (entry.flowRuleTraces || []).some(trace => trace.sourceRuleId === sourceRuleId && trace.sinkRuleId === sinkRuleId));
}
async function main(): Promise<void> {
    const root = resolveTestRunDir("analyze", "axios_config_sink");
    const repoRoot = resolveTestRunPath("analyze", "axios_config_sink", "fixtures", "repo");
    const sourceRulePath = resolveTestRunPath("analyze", "axios_config_sink", "fixtures", "source.rules.json");
    const outputDir = resolveTestRunPath("analyze", "axios_config_sink", "runs", "with_kernel_axios_config");
    fs.rmSync(root, { recursive: true, force: true });
    const etsRoot = path.join(repoRoot, "entry", "src", "main", "ets");
    writeText(path.join(etsRoot, "entryability", "EntryAbility.ets"), [
        "import axios from '@ohos/axios';",
        "",
        "class UIAbility {",
        "  onCreate(): void {}",
        "}",
        "",
        "function Phone(): string { return 'phone'; }",
        "function Password(): string { return 'password'; }",
        "function Query(): string { return 'query'; }",
        "function Url(): string { return 'https://example.test'; }",
        "function InstancePayload(): string { return 'instance-payload'; }",
        "function InstanceParam(): string { return 'instance-param'; }",
        "function InstanceUrl(): string { return 'https://instance.example.test'; }",
        "function MethodOnly(): string { return 'POST'; }",
        "function TimeoutOnly(): number { return 1000; }",
        "",
        "export default class EntryAbility extends UIAbility {",
        "  onCreate(): void {",
        "    const client = axios.create({ baseURL: 'https://api.example.test' });",
        "    axios({",
        "      url: '/login',",
        "      method: 'POST',",
        "      data: { phone: Phone(), password: Password() },",
        "      timeout: TimeoutOnly(),",
        "    });",
        "    axios({",
        "      url: Url(),",
        "      method: MethodOnly(),",
        "      params: { q: Query() },",
        "      data: { phone: 'safe-phone' },",
        "    });",
        "    axios.get('/code', {",
        "      params: { phone: Phone() },",
        "      timeout: TimeoutOnly(),",
        "    });",
        "    client.get(InstanceUrl());",
        "    client.request({",
        "      url: InstanceUrl(),",
        "      data: { phone: InstancePayload() },",
        "      params: { q: InstanceParam() },",
        "    });",
        "    new AxiosHolder().send();",
        "  }",
        "}",
        "",
        "class AxiosHolder {",
        "  private instance: import('@ohos/axios').AxiosInstance;",
        "  constructor() {",
        "    this.instance = axios.create({ timeout: 1000 });",
        "  }",
        "  send(): void {",
        "    this.instance.request({",
        "      url: InstanceUrl(),",
        "      data: { phone: InstancePayload() },",
        "      params: { q: InstanceParam() },",
        "    });",
        "  }",
        "}",
        "",
    ].join("\n"));
    writeText(path.join(etsRoot, "entryability", "LocalAxiosAbility.ets"), [
        "class UIAbility {",
        "  onCreate(): void {}",
        "}",
        "",
        "function LocalPhone(): string { return 'local-phone'; }",
        "function axios(config: any): void {",
        "  const ignored = config;",
        "}",
        "class FakeClient {",
        "  get(url: any): void { const ignored = url; }",
        "  request(config: any): void { const ignored = config; }",
        "}",
        "",
        "export default class LocalAxiosAbility extends UIAbility {",
        "  onCreate(): void {",
        "    axios({",
        "      data: { phone: LocalPhone() },",
        "    });",
        "    const client = new FakeClient();",
        "    client.get(LocalPhone());",
        "    client.request({ data: { phone: LocalPhone() } });",
        "  }",
        "}",
        "",
    ].join("\n"));
    writeText(sourceRulePath, stringifyRuleAssetFixture({
        id: "asset.rule.fixture.axios_config_sources",
        sources: [
            { id: "source.fixture.axios.phone", sourceKind: "call_return", surface: { kind: "invoke", methodName: "Phone" }, target: "result" },
            { id: "source.fixture.axios.password", sourceKind: "call_return", surface: { kind: "invoke", methodName: "Password" }, target: "result" },
            { id: "source.fixture.axios.query", sourceKind: "call_return", surface: { kind: "invoke", methodName: "Query" }, target: "result" },
            { id: "source.fixture.axios.url", sourceKind: "call_return", surface: { kind: "invoke", methodName: "Url" }, target: "result" },
            { id: "source.fixture.axios.instance_payload", sourceKind: "call_return", surface: { kind: "invoke", methodName: "InstancePayload" }, target: "result" },
            { id: "source.fixture.axios.instance_param", sourceKind: "call_return", surface: { kind: "invoke", methodName: "InstanceParam" }, target: "result" },
            { id: "source.fixture.axios.instance_url", sourceKind: "call_return", surface: { kind: "invoke", methodName: "InstanceUrl" }, target: "result" },
            { id: "source.fixture.axios.method", sourceKind: "call_return", surface: { kind: "invoke", methodName: "MethodOnly" }, target: "result" },
            { id: "source.fixture.axios.timeout", sourceKind: "call_return", surface: { kind: "invoke", methodName: "TimeoutOnly" }, target: "result" },
            { id: "source.fixture.axios.local_phone", sourceKind: "call_return", surface: { kind: "invoke", methodName: "LocalPhone" }, target: "result" }
        ],
        sinks: [],
        sanitizers: [],
        transfers: []
    }));
    runAnalyzeCli([
        "--repo", repoRoot,
        "--sourceDir", "entry/src/main/ets",
        "--project", sourceRulePath,
        "--model-root", "src/models",
        "--reportMode", "full",
        "--no-incremental",
        "--k", "1",
        "--outputDir", outputDir,
    ]);
    const summary = readAnalyzeSummary<AnalyzeSummary>(outputDir);
    assert(summary.summary.totalFlows > 0, "expected axios config sinks to produce flows");
    assert(hasTrace(summary, "source.fixture.axios.phone", "sink.harmony.axios.call.body.arg0.data"), "axios(config).data should report tainted phone payload");
    assert(hasTrace(summary, "source.fixture.axios.password", "sink.harmony.axios.call.body.arg0.data"), "axios(config).data should report tainted password payload");
    assert(hasTrace(summary, "source.fixture.axios.url", "sink.harmony.axios.call.url.arg0.url"), "axios(config).url should report tainted URL");
    assert(hasTrace(summary, "source.fixture.axios.query", "sink.harmony.axios.call.params.arg0.params"), "axios(config).params should report tainted query params");
    assert(hasTrace(summary, "source.fixture.axios.phone", "sink.harmony.axios.get.params.arg1.params"), "axios.get config.params should report tainted phone params");
    assert(hasTrace(summary, "source.fixture.axios.instance_url", "sink.harmony.axios.get.url.arg0"), "axios.create instance get(url) should report tainted URL");
    assert(hasTrace(summary, "source.fixture.axios.instance_url", "sink.harmony.axios.request.url.arg0.url"), "axios.create instance request(config).url should report tainted URL");
    assert(hasTrace(summary, "source.fixture.axios.instance_payload", "sink.harmony.axios.request.body.arg0.data"), "axios.create instance request(config).data should report tainted payload");
    assert(hasTrace(summary, "source.fixture.axios.instance_param", "sink.harmony.axios.request.params.arg0.params"), "axios.create instance request(config).params should report tainted params");
    for (const sinkRuleId of [
        "sink.harmony.axios.call.url.arg0.url",
        "sink.harmony.axios.call.body.arg0.data",
        "sink.harmony.axios.call.params.arg0.params",
        "sink.harmony.axios.get.params.arg1.params",
        "sink.harmony.axios.get.url.arg0",
        "sink.harmony.axios.request.url.arg0.url",
        "sink.harmony.axios.request.body.arg0.data",
        "sink.harmony.axios.request.params.arg0.params",
    ]) {
        assert(!hasTrace(summary, "source.fixture.axios.method", sinkRuleId), `HTTP method option must not satisfy ${sinkRuleId}`);
        assert(!hasTrace(summary, "source.fixture.axios.timeout", sinkRuleId), `timeout option must not satisfy ${sinkRuleId}`);
        assert(!hasTrace(summary, "source.fixture.axios.local_phone", sinkRuleId), `local same-name axios function without @ohos/axios import must not satisfy ${sinkRuleId}`);
    }
    console.log("PASS test_analyze_axios_config_sink");
    console.log(`total_flows=${summary.summary.totalFlows}`);
}
main().catch(error => {
    console.error("FAIL test_analyze_axios_config_sink");
    console.error(error);
    process.exit(1);
});
