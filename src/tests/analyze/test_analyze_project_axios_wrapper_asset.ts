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
    const root = resolveTestRunDir("analyze", "project_axios_wrapper_asset");
    const repoRoot = resolveTestRunPath("analyze", "project_axios_wrapper_asset", "fixtures", "repo");
    const sourceRulePath = resolveTestRunPath("analyze", "project_axios_wrapper_asset", "fixtures", "source.rules.json");
    const outputDir = resolveTestRunPath("analyze", "project_axios_wrapper_asset", "runs", "with_project_assets");
    fs.rmSync(root, { recursive: true, force: true });
    const etsRoot = path.join(repoRoot, "entry", "src", "main", "ets");
    writeText(path.join(etsRoot, "httpRequest", "BaseProvider.ets"), [
        "export class BaseProvider {",
        "  post(path: string, data?: string, config?: any): void {}",
        "}",
        "",
    ].join("\n"));
    writeText(path.join(etsRoot, "viewModel", "SearchResultViewModel.ets"), [
        "export interface KeywordInfo {",
        "  k: string;",
        "  role?: string;",
        "}",
        "export class SearchResultViewModel {",
        "  postSearchResultList(type: number, keywordInfo: KeywordInfo): void {}",
        "}",
        "",
    ].join("\n"));
    writeText(path.join(etsRoot, "net", "wanAPI", "WanHttpClient.ets"), [
        "export class WanHttpClient {",
        "  query(words: string, index: number): void {}",
        "  shareArticle(title: string, link: string): void {}",
        "  collectUrl(name: string, link: string): void {}",
        "}",
        "",
    ].join("\n"));
    writeText(path.join(etsRoot, "net", "other", "OtherWanHttpClient.ets"), [
        "export class OtherWanHttpClient {",
        "  query(words: string, index: number): void {}",
        "}",
        "",
    ].join("\n"));
    writeText(path.join(etsRoot, "network", "HttpManager.ets"), [
        "export class HttpManager {",
        "  static login(phoneNumber: string, verifyCode: string, sessionID: string): void {}",
        "  static getSms(captchaAppID: string, ticket: string, randStr: string, phoneNumber: string): void {}",
        "}",
        "class GlobalSchedule {",
        "  request(api: string, params: Map<string, string>): void {}",
        "}",
        "",
    ].join("\n"));
    writeText(path.join(etsRoot, "network", "OtherHttpManager.ets"), [
        "export class HttpManager {",
        "  static login(phoneNumber: string, verifyCode: string, sessionID: string): void {}",
        "}",
        "",
    ].join("\n"));
    writeText(path.join(etsRoot, "apis", "AxiosHttp.ets"), [
        "export class AxiosHttpRequest {",
        "  request(config: any): void {}",
        "  get(config: any): void {}",
        "  post(config: any): void {}",
        "}",
        "",
    ].join("\n"));
    writeText(path.join(etsRoot, "apis", "OtherAxiosHttp.ets"), [
        "export class AxiosHttpRequest {",
        "  request(config: any): void {}",
        "}",
        "",
    ].join("\n"));
    writeText(path.join(etsRoot, "api", "Index.ets"), [
        "export function addDnOrder(list: Array<any>, params: any): void {}",
        "",
    ].join("\n"));
    writeText(path.join(etsRoot, "api", "OtherOrderApi.ets"), [
        "export function addDnOrder(list: Array<any>, params: any): void {}",
        "",
    ].join("\n"));
    writeText(path.join(etsRoot, "entryability", "EntryAbility.ets"), [
        "import { BaseProvider } from '../httpRequest/BaseProvider';",
        "import { SearchResultViewModel } from '../viewModel/SearchResultViewModel';",
        "import { WanHttpClient } from '../net/wanAPI/WanHttpClient';",
        "import { OtherWanHttpClient } from '../net/other/OtherWanHttpClient';",
        "import { HttpManager } from '../network/HttpManager';",
        "import { HttpManager as OtherHttpManager } from '../network/OtherHttpManager';",
        "import { AxiosHttpRequest } from '../apis/AxiosHttp';",
        "import { AxiosHttpRequest as OtherAxiosHttpRequest } from '../apis/OtherAxiosHttp';",
        "import * as OrderApi from '../api/Index';",
        "import * as OtherOrderApi from '../api/OtherOrderApi';",
        "",
        "class UIAbility {",
        "  onCreate(): void {}",
        "}",
        "",
        "function HarmonyPayload(): string { return 'harmony-payload'; }",
        "function HarmonyKeyword(): string { return 'harmony-keyword'; }",
        "function HarmonySibling(): string { return 'harmony-sibling'; }",
        "function HarmonyPath(): string { return 'harmony-path'; }",
        "function WanWords(): string { return 'wan-words'; }",
        "function WanTitle(): string { return 'wan-title'; }",
        "function WanLink(): string { return 'wan-link'; }",
        "function WanName(): string { return 'wan-name'; }",
        "function OtherWords(): string { return 'other-words'; }",
        "function TencentPhone(): string { return 'tencent-phone'; }",
        "function TencentCode(): string { return 'tencent-code'; }",
        "function TencentOtherPhone(): string { return 'tencent-other-phone'; }",
        "function CateringData(): string { return 'catering-data'; }",
        "function CateringParam(): string { return 'catering-param'; }",
        "function CateringUrl(): string { return 'catering-url'; }",
        "function CateringOtherData(): string { return 'catering-other-data'; }",
        "function CateringBusinessPhone(): string { return 'catering-business-phone'; }",
        "function CateringBusinessNote(): string { return 'catering-business-note'; }",
        "function CateringOtherBusinessPhone(): string { return 'catering-other-business-phone'; }",
        "",
        "export default class EntryAbility extends UIAbility {",
        "  onCreate(): void {",
        "    const base = new BaseProvider();",
        "    const vm = new SearchResultViewModel();",
        "    const wan = new WanHttpClient();",
        "    const other = new OtherWanHttpClient();",
        "    const catering = new AxiosHttpRequest();",
        "    const otherCatering = new OtherAxiosHttpRequest();",
        "",
        "    base.post('/search', HarmonyPayload(), { ignored: HarmonySibling() });",
        "    base.post(HarmonyPath(), 'safe-body', {});",
        "    vm.postSearchResultList(0, { k: HarmonyKeyword(), role: 'safe-role' });",
        "    vm.postSearchResultList(0, { k: 'safe-keyword', role: HarmonySibling() });",
        "",
        "    wan.query(WanWords(), 1);",
        "    wan.shareArticle(WanTitle(), WanLink());",
        "    wan.collectUrl(WanName(), WanLink());",
        "    other.query(OtherWords(), 1);",
        "    HttpManager.login(TencentPhone(), TencentCode(), 'session');",
        "    HttpManager.getSms('captcha', 'ticket', 'rand', TencentPhone());",
        "    OtherHttpManager.login(TencentOtherPhone(), 'code', 'session');",
        "    catering.request({ url: CateringUrl(), data: { phone: CateringData() }, params: { q: CateringParam() } });",
        "    catering.get({ params: { q: CateringParam() }, timeout: 1000 });",
        "    catering.post({ data: { phone: CateringData() }, timeout: 1000 });",
        "    otherCatering.request({ data: { phone: CateringOtherData() } });",
        "    OrderApi.addDnOrder([], { preorderPhone: CateringBusinessPhone(), note: 'safe-note' });",
        "    OrderApi.addDnOrder([], { preorderPhone: 'safe-phone', note: CateringBusinessNote() });",
        "    OtherOrderApi.addDnOrder([], { preorderPhone: CateringOtherBusinessPhone() });",
        "  }",
        "}",
        "",
    ].join("\n"));
    writeText(sourceRulePath, stringifyRuleAssetFixture({
        id: "asset.rule.fixture.project_axios_wrapper_sources",
        sources: [
            { id: "source.fixture.harmony.payload", sourceKind: "call_return", surface: { kind: "invoke", methodName: "HarmonyPayload" }, target: "result" },
            { id: "source.fixture.harmony.keyword", sourceKind: "call_return", surface: { kind: "invoke", methodName: "HarmonyKeyword" }, target: "result" },
            { id: "source.fixture.harmony.sibling", sourceKind: "call_return", surface: { kind: "invoke", methodName: "HarmonySibling" }, target: "result" },
            { id: "source.fixture.harmony.path", sourceKind: "call_return", surface: { kind: "invoke", methodName: "HarmonyPath" }, target: "result" },
            { id: "source.fixture.wan.words", sourceKind: "call_return", surface: { kind: "invoke", methodName: "WanWords" }, target: "result" },
            { id: "source.fixture.wan.title", sourceKind: "call_return", surface: { kind: "invoke", methodName: "WanTitle" }, target: "result" },
            { id: "source.fixture.wan.link", sourceKind: "call_return", surface: { kind: "invoke", methodName: "WanLink" }, target: "result" },
            { id: "source.fixture.wan.name", sourceKind: "call_return", surface: { kind: "invoke", methodName: "WanName" }, target: "result" },
            { id: "source.fixture.wan.other", sourceKind: "call_return", surface: { kind: "invoke", methodName: "OtherWords" }, target: "result" },
            { id: "source.fixture.tencent.phone", sourceKind: "call_return", surface: { kind: "invoke", methodName: "TencentPhone" }, target: "result" },
            { id: "source.fixture.tencent.code", sourceKind: "call_return", surface: { kind: "invoke", methodName: "TencentCode" }, target: "result" },
            { id: "source.fixture.tencent.other_phone", sourceKind: "call_return", surface: { kind: "invoke", methodName: "TencentOtherPhone" }, target: "result" },
            { id: "source.fixture.catering.data", sourceKind: "call_return", surface: { kind: "invoke", methodName: "CateringData" }, target: "result" },
            { id: "source.fixture.catering.param", sourceKind: "call_return", surface: { kind: "invoke", methodName: "CateringParam" }, target: "result" },
            { id: "source.fixture.catering.url", sourceKind: "call_return", surface: { kind: "invoke", methodName: "CateringUrl" }, target: "result" },
            { id: "source.fixture.catering.other_data", sourceKind: "call_return", surface: { kind: "invoke", methodName: "CateringOtherData" }, target: "result" },
            { id: "source.fixture.catering.business_phone", sourceKind: "call_return", surface: { kind: "invoke", methodName: "CateringBusinessPhone" }, target: "result" },
            { id: "source.fixture.catering.business_note", sourceKind: "call_return", surface: { kind: "invoke", methodName: "CateringBusinessNote" }, target: "result" },
            { id: "source.fixture.catering.other_business_phone", sourceKind: "call_return", surface: { kind: "invoke", methodName: "CateringOtherBusinessPhone" }, target: "result" }
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
        "--enable-model", "harmony_study_external,wanandroid_harmoney_external,tencent_rtc_tuikit_external,catering_orders_external",
        "--reportMode", "full",
        "--no-incremental",
        "--k", "1",
        "--outputDir", outputDir,
    ]);
    const summary = readAnalyzeSummary<AnalyzeSummary>(outputDir);
    assert(summary.summary.totalFlows > 0, "expected project axios wrapper assets to produce flows");
    assert(hasTrace(summary, "source.fixture.harmony.payload", "project.harmony_study_external.BaseProvider.post.data"), "HarmonyStudy BaseProvider.post data endpoint should report tainted payload");
    assert(hasTrace(summary, "source.fixture.harmony.keyword", "project.harmony_study_external.SearchResultViewModel.postSearchResultList.keyword"), "HarmonyStudy SearchResultViewModel keyword endpoint should report keywordInfo.k");
    assert(hasTrace(summary, "source.fixture.wan.words", "project.wanandroid_harmoney_external.WanHttpClient.query.words"), "WanAndroid query words endpoint should report words");
    assert(hasTrace(summary, "source.fixture.wan.title", "project.wanandroid_harmoney_external.WanHttpClient.shareArticle.title"), "WanAndroid shareArticle title endpoint should report title");
    assert(hasTrace(summary, "source.fixture.wan.link", "project.wanandroid_harmoney_external.WanHttpClient.shareArticle.link"), "WanAndroid shareArticle link endpoint should report link");
    assert(hasTrace(summary, "source.fixture.wan.name", "project.wanandroid_harmoney_external.WanHttpClient.collectUrl.name"), "WanAndroid collectUrl name endpoint should report name");
    assert(hasTrace(summary, "source.fixture.tencent.phone", "project.tencent_rtc_tuikit_external.HttpManager.login.phone"), "Tencent HttpManager.login phone endpoint should report phone");
    assert(hasTrace(summary, "source.fixture.tencent.code", "project.tencent_rtc_tuikit_external.HttpManager.login.code"), "Tencent HttpManager.login code endpoint should report code");
    assert(hasTrace(summary, "source.fixture.tencent.phone", "project.tencent_rtc_tuikit_external.HttpManager.getSms.phone"), "Tencent HttpManager.getSms phone endpoint should report phone");
    assert(hasTrace(summary, "source.fixture.catering.url", "project.catering_orders_external.AxiosHttpRequest.request.url"), "Catering AxiosHttpRequest.request url endpoint should report url");
    assert(hasTrace(summary, "source.fixture.catering.data", "project.catering_orders_external.AxiosHttpRequest.request.data"), "Catering AxiosHttpRequest.request data endpoint should report data");
    assert(hasTrace(summary, "source.fixture.catering.param", "project.catering_orders_external.AxiosHttpRequest.get.params"), "Catering AxiosHttpRequest.get params endpoint should report params");
    assert(hasTrace(summary, "source.fixture.catering.business_phone", "project.catering_orders_external.OrderApi.addDnOrder.preorderPhone"), "Catering OrderApi.addDnOrder should report params.preorderPhone as a reviewed project network boundary");
    assert(!hasTrace(summary, "source.fixture.harmony.sibling", "project.harmony_study_external.SearchResultViewModel.postSearchResultList.keyword"), "sibling keywordInfo.role must not satisfy keywordInfo.k sink");
    assert(!hasTrace(summary, "source.fixture.harmony.path", "project.harmony_study_external.BaseProvider.post.data"), "tainted path argument must not satisfy BaseProvider.post data sink");
    assert(!hasTrace(summary, "source.fixture.wan.other", "project.wanandroid_harmoney_external.WanHttpClient.query.words"), "same-named query method in unrelated class must not satisfy WanHttpClient scoped asset");
    assert(!hasTrace(summary, "source.fixture.tencent.other_phone", "project.tencent_rtc_tuikit_external.HttpManager.login.phone"), "same-named HttpManager in unrelated file must not satisfy Tencent scoped asset");
    assert(!hasTrace(summary, "source.fixture.catering.other_data", "project.catering_orders_external.AxiosHttpRequest.request.data"), "same-named AxiosHttpRequest in unrelated file must not satisfy Catering scoped asset");
    assert(!hasTrace(summary, "source.fixture.catering.business_note", "project.catering_orders_external.OrderApi.addDnOrder.preorderPhone"), "sibling params.note must not satisfy OrderApi params.preorderPhone sink");
    assert(!hasTrace(summary, "source.fixture.catering.other_business_phone", "project.catering_orders_external.OrderApi.addDnOrder.preorderPhone"), "same-named addDnOrder in unrelated file must not satisfy Catering OrderApi scoped asset");
    console.log("PASS test_analyze_project_axios_wrapper_asset");
    console.log(`total_flows=${summary.summary.totalFlows}`);
}
main().catch(error => {
    console.error("FAIL test_analyze_project_axios_wrapper_asset");
    console.error(error);
    process.exit(1);
});
