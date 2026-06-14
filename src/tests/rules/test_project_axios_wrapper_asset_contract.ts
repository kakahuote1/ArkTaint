import * as fs from "fs";
import * as path from "path";
import {
    validateAssetDocument,
    type AssetDocumentBase,
} from "../../core/assets/schema";
import type { RuleEndpointOrRef, SinkRule } from "../../core/rules/RuleSchema";
import { lowerRuleAssetsToRuleSet } from "../../core/rules/RuleAssetLowering";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function readAsset(projectId: string): AssetDocumentBase {
    const assetPath = path.resolve("src/models/project", projectId, "rules", "semanticflow.rules.json");
    return JSON.parse(fs.readFileSync(assetPath, "utf8")) as AssetDocumentBase;
}

function endpointKey(endpoint: RuleEndpointOrRef | undefined): string {
    if (!endpoint) return "<missing>";
    if (typeof endpoint === "string") return endpoint;
    const suffix = endpoint.path && endpoint.path.length > 0 ? `.${endpoint.path.join(".")}` : "";
    const semantic = endpoint.semanticEndpointKind ? `#${endpoint.semanticEndpointKind}` : "";
    return `${endpoint.endpoint}${suffix}${semantic}`;
}

function sinksFor(sinks: SinkRule[], methodName: string): SinkRule[] {
    return sinks.filter(rule => rule.match.kind === "method_name_equals" && rule.match.value === methodName);
}

function ruleById(sinks: SinkRule[], id: string): SinkRule {
    const rule = sinks.find(item => item.id === id);
    assert(rule, `missing lowered sink rule ${id}`);
    return rule;
}

function assertScopedProjectRule(rule: SinkRule, fileTail: string, className: string): void {
    const scope = rule.scope;
    assert(scope?.file?.mode === "contains", `${rule.id} must be scoped to a project file`);
    assert(scope.file.value === fileTail, `${rule.id} file scope drifted: ${scope.file.value}`);
    assert(scope?.className?.mode === "equals", `${rule.id} must be scoped to an exact project class`);
    assert(scope.className.value === className, `${rule.id} class scope drifted: ${scope.className.value}`);
    assert(rule.match.kind === "method_name_equals", `${rule.id} must not use broad method regex matching`);
}

function assertScopedProjectFunctionRule(rule: SinkRule, fileTail: string): void {
    const scope = rule.scope;
    assert(scope?.file?.mode === "contains", `${rule.id} must be scoped to a project file`);
    assert(scope.file.value === fileTail, `${rule.id} file scope drifted: ${scope.file.value}`);
    assert(!scope.className, `${rule.id} must not invent a class scope for a free function`);
    assert(rule.match.kind === "method_name_equals", `${rule.id} must not use broad method regex matching`);
}

function assertReviewedProjectAsset(asset: AssetDocumentBase, projectId: string): void {
    const validation = validateAssetDocument(asset);
    assert(validation.valid, `${projectId} asset invalid:\n${validation.errors.join("\n")}`);
    assert(asset.status === "reviewed", `${projectId} asset must be reviewed`);
    assert(asset.plane === "rule", `${projectId} visible request-wrapper semantics must stay in rule plane`);
    assert(asset.provenance.source === "manual", `${projectId} asset must have manual source-audit provenance`);
    assert(asset.provenance.projectId === projectId, `${projectId} asset must stay project-scoped`);
}

function main(): void {
    const harmonyAsset = readAsset("harmony_study_external");
    const wanAsset = readAsset("wanandroid_harmoney_external");
    const tencentAsset = readAsset("tencent_rtc_tuikit_external");
    const cateringAsset = readAsset("catering_orders_external");
    assertReviewedProjectAsset(harmonyAsset, "harmony_study_external");
    assertReviewedProjectAsset(wanAsset, "wanandroid_harmoney_external");
    assertReviewedProjectAsset(tencentAsset, "tencent_rtc_tuikit_external");
    assertReviewedProjectAsset(cateringAsset, "catering_orders_external");

    const lowered = lowerRuleAssetsToRuleSet([harmonyAsset, wanAsset, tencentAsset, cateringAsset]);
    assert(lowered.diagnostics.length === 0, `unexpected lowering diagnostics:\n${lowered.diagnostics.join("\n")}`);

    const postSinks = sinksFor(lowered.ruleSet.sinks, "post")
        .filter(rule => rule.id.includes("harmony_study_external"));
    const searchSinks = sinksFor(lowered.ruleSet.sinks, "postSearchResultList");
    const querySinks = sinksFor(lowered.ruleSet.sinks, "query");
    const shareSinks = sinksFor(lowered.ruleSet.sinks, "shareArticle");
    const collectSinks = sinksFor(lowered.ruleSet.sinks, "collectUrl");
    const orderApiSinks = sinksFor(lowered.ruleSet.sinks, "addDnOrder")
        .filter(rule => rule.id.includes("catering_orders_external.OrderApi"));

    assert(postSinks.length === 1, `expected one HarmonyStudy BaseProvider.post sink, got ${postSinks.length}`);
    assert(searchSinks.length === 1, `expected one HarmonyStudy SearchResultViewModel sink, got ${searchSinks.length}`);
    assert(querySinks.length === 1, `expected one WanAndroid query sink, got ${querySinks.length}`);
    assert(shareSinks.length === 2, `expected two WanAndroid shareArticle sinks, got ${shareSinks.length}`);
    assert(collectSinks.length === 2, `expected two WanAndroid collectUrl sinks, got ${collectSinks.length}`);
    assert(orderApiSinks.length === 1, `expected one Catering OrderApi.addDnOrder sink, got ${orderApiSinks.length}`);

    for (const rule of postSinks) assertScopedProjectRule(rule, "ets/httpRequest/BaseProvider.ets", "BaseProvider");
    for (const rule of searchSinks) assertScopedProjectRule(rule, "ets/viewModel/SearchResultViewModel.ets", "SearchResultViewModel");
    for (const rule of querySinks) assertScopedProjectRule(rule, "ets/net/wanAPI/WanHttpClient.ets", "WanHttpClient");
    for (const rule of shareSinks) assertScopedProjectRule(rule, "ets/net/wanAPI/WanHttpClient.ets", "WanHttpClient");
    for (const rule of collectSinks) assertScopedProjectRule(rule, "ets/net/wanAPI/WanHttpClient.ets", "WanHttpClient");
    for (const rule of orderApiSinks) assertScopedProjectFunctionRule(rule, "ets/api/Index.ets");

    assertScopedProjectRule(
        ruleById(lowered.ruleSet.sinks, "project.tencent_rtc_tuikit_external.HttpManager.login.phone"),
        "ets/network/HttpManager.ets",
        "HttpManager",
    );
    assertScopedProjectRule(
        ruleById(lowered.ruleSet.sinks, "project.tencent_rtc_tuikit_external.HttpManager.login.code"),
        "ets/network/HttpManager.ets",
        "HttpManager",
    );
    assertScopedProjectRule(
        ruleById(lowered.ruleSet.sinks, "project.tencent_rtc_tuikit_external.HttpManager.getSms.phone"),
        "ets/network/HttpManager.ets",
        "HttpManager",
    );
    assertScopedProjectRule(
        ruleById(lowered.ruleSet.sinks, "project.catering_orders_external.AxiosHttpRequest.request.data"),
        "ets/apis/AxiosHttp.ets",
        "AxiosHttpRequest",
    );
    assertScopedProjectRule(
        ruleById(lowered.ruleSet.sinks, "project.catering_orders_external.AxiosHttpRequest.get.params"),
        "ets/apis/AxiosHttp.ets",
        "AxiosHttpRequest",
    );

    assert(endpointKey(postSinks[0].target) === "arg1", `post endpoint drifted: ${endpointKey(postSinks[0].target)}`);
    assert(endpointKey(searchSinks[0].target) === "arg1.k", `postSearchResultList endpoint drifted: ${endpointKey(searchSinks[0].target)}`);
    assert(endpointKey(querySinks[0].target) === "arg0", `query endpoint drifted: ${endpointKey(querySinks[0].target)}`);
    assert(
        JSON.stringify(shareSinks.map(rule => endpointKey(rule.target)).sort()) === JSON.stringify(["arg0", "arg1"]),
        `shareArticle endpoints drifted: ${shareSinks.map(rule => endpointKey(rule.target)).join(", ")}`,
    );
    assert(
        JSON.stringify(collectSinks.map(rule => endpointKey(rule.target)).sort()) === JSON.stringify(["arg0", "arg1"]),
        `collectUrl endpoints drifted: ${collectSinks.map(rule => endpointKey(rule.target)).join(", ")}`,
    );
    assert(
        endpointKey(ruleById(lowered.ruleSet.sinks, "project.tencent_rtc_tuikit_external.HttpManager.login.phone").target) === "arg0",
        "Tencent HttpManager.login phone endpoint drifted",
    );
    assert(
        endpointKey(ruleById(lowered.ruleSet.sinks, "project.tencent_rtc_tuikit_external.HttpManager.login.code").target) === "arg1",
        "Tencent HttpManager.login code endpoint drifted",
    );
    assert(
        endpointKey(ruleById(lowered.ruleSet.sinks, "project.catering_orders_external.AxiosHttpRequest.request.data").target) === "arg0.data",
        "Catering AxiosHttpRequest.request data endpoint drifted",
    );
    assert(
        endpointKey(ruleById(lowered.ruleSet.sinks, "project.catering_orders_external.AxiosHttpRequest.get.params").target) === "arg0.params",
        "Catering AxiosHttpRequest.get params endpoint drifted",
    );
    assert(
        endpointKey(ruleById(lowered.ruleSet.sinks, "project.catering_orders_external.OrderApi.addDnOrder.preorderPhone").target) === "arg1.preorderPhone",
        "Catering OrderApi.addDnOrder preorderPhone endpoint drifted",
    );

    console.log("PASS test_project_axios_wrapper_asset_contract");
}

main();
