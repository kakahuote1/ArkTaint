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

function sinksFor(sinks: SinkRule[], methodName: string, fileTail: string, className: string): SinkRule[] {
    return sinks.filter(rule =>
        rule.match.kind === "method_name_equals"
        && rule.match.value === methodName
        && rule.scope?.file?.mode === "contains"
        && rule.scope.file.value === fileTail
        && rule.scope?.className?.mode === "equals"
        && rule.scope.className.value === className);
}

function assertReviewedProjectAsset(asset: AssetDocumentBase, projectId: string): void {
    const validation = validateAssetDocument(asset);
    assert(validation.valid, `${projectId} asset invalid:\n${validation.errors.join("\n")}`);
    assert(asset.status === "reviewed", `${projectId} asset must be reviewed`);
    assert(asset.plane === "rule", `${projectId} visible request-wrapper semantics must stay in rule plane`);
    assert(asset.provenance.source === "manual", `${projectId} asset must have manual source-audit provenance`);
    assert(asset.provenance.projectId === projectId, `${projectId} asset must stay project-scoped`);
}

function endpointList(rules: SinkRule[]): string[] {
    return rules.map(rule => endpointKey(rule.target)).sort();
}

function main(): void {
    const weatherAsset = readAsset("weather_app_queyun_external");
    const openImAsset = readAsset("openim_demo_external");
    assertReviewedProjectAsset(weatherAsset, "weather_app_queyun_external");
    assertReviewedProjectAsset(openImAsset, "openim_demo_external");

    const lowered = lowerRuleAssetsToRuleSet([weatherAsset, openImAsset]);
    assert(lowered.diagnostics.length === 0, `unexpected lowering diagnostics:\n${lowered.diagnostics.join("\n")}`);

    const weatherGet = sinksFor(lowered.ruleSet.sinks, "get", "ets/utils/HttpUtil.ets", "HttpUtil");
    const weatherCity = sinksFor(lowered.ruleSet.sinks, "getWeatherByCityId", "ets/utils/HttpUtil.ets", "HttpUtil");
    const weatherSearch = sinksFor(lowered.ruleSet.sinks, "searchCitiesByName", "ets/utils/HttpUtil.ets", "HttpUtil");
    assert(endpointList(weatherGet).join(",") === "arg0", `Weather HttpUtil.get endpoint drifted: ${endpointList(weatherGet).join(",")}`);
    assert(endpointList(weatherCity).join(",") === "arg0", `Weather getWeatherByCityId endpoint drifted: ${endpointList(weatherCity).join(",")}`);
    assert(endpointList(weatherSearch).join(",") === "arg0", `Weather searchCitiesByName endpoint drifted: ${endpointList(weatherSearch).join(",")}`);

    const httpGet = sinksFor(lowered.ruleSet.sinks, "get", "ets/api/HttpClient.ets", "HttpClient");
    const httpPost = sinksFor(lowered.ruleSet.sinks, "post", "ets/api/HttpClient.ets", "HttpClient");
    const chatLogin = sinksFor(lowered.ruleSet.sinks, "login", "ets/api/ChatClient.ets", "ChatClient");
    const sendText = sinksFor(lowered.ruleSet.sinks, "sendTextMessage", "ets/views/chat/ChatViewModel.ets", "ChatViewModel");

    assert(endpointList(httpGet).join(",") === "arg0", `OpenIM HttpClient.get endpoint drifted: ${endpointList(httpGet).join(",")}`);
    assert(
        endpointList(httpPost).join(",") === ["arg0", "arg1"].join(","),
        `OpenIM HttpClient.post endpoints drifted: ${endpointList(httpPost).join(",")}`,
    );
    assert(endpointList(chatLogin).join(",") === "arg0", `OpenIM ChatClient.login endpoint drifted: ${endpointList(chatLogin).join(",")}`);
    assert(endpointList(sendText).join(",") === "arg0", `OpenIM sendTextMessage endpoint drifted: ${endpointList(sendText).join(",")}`);

    for (const rule of [
        ...weatherGet,
        ...weatherCity,
        ...weatherSearch,
        ...httpGet,
        ...httpPost,
        ...chatLogin,
        ...sendText,
    ]) {
        assert(rule.match.kind === "method_name_equals", `${rule.id} must not use regex or broad matching`);
        assert(rule.scope?.file?.mode === "contains", `${rule.id} must be file-scoped`);
        assert(rule.scope?.className?.mode === "equals", `${rule.id} must be class-scoped`);
    }

    console.log("PASS test_project_request_wrapper_asset_contract");
}

main();
