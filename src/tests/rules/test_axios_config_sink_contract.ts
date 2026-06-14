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

function readNetworkAsset(): AssetDocumentBase {
    const assetPath = path.resolve("src/models/kernel/rules/sinks/network.rules.json");
    return JSON.parse(fs.readFileSync(assetPath, "utf8")) as AssetDocumentBase;
}

function endpointKey(endpoint: RuleEndpointOrRef | undefined): string {
    if (!endpoint) return "<missing>";
    if (typeof endpoint === "string") return endpoint;
    const suffix = endpoint.path && endpoint.path.length > 0 ? `.${endpoint.path.join(".")}` : "";
    return `${endpoint.endpoint}${suffix}`;
}

function ruleById(rules: SinkRule[], id: string): SinkRule {
    const rule = rules.find(item => item.id === id);
    assert(rule, `missing lowered sink rule ${id}`);
    return rule;
}

function assertAxiosScoped(rule: SinkRule): void {
    assert(rule.scope?.module?.mode === "contains", `${rule.id} must be scoped to @ohos/axios`);
    assert(rule.scope.module.value === "@ohos/axios", `${rule.id} module scope drifted: ${rule.scope.module.value}`);
    assert(rule.match.kind === "method_name_equals", `${rule.id} must not use broad method matching`);
    assert(rule.match.typeHint === "axios", `${rule.id} must carry axios type hint`);
}

function main(): void {
    const asset = readNetworkAsset();
    const validation = validateAssetDocument(asset);
    assert(validation.valid, `network asset invalid:\n${validation.errors.join("\n")}`);

    const lowered = lowerRuleAssetsToRuleSet([asset]);
    assert(lowered.diagnostics.length === 0, `unexpected lowering diagnostics:\n${lowered.diagnostics.join("\n")}`);

    const callUrl = ruleById(lowered.ruleSet.sinks, "sink.harmony.axios.call.url.arg0.url");
    const callData = ruleById(lowered.ruleSet.sinks, "sink.harmony.axios.call.body.arg0.data");
    const callParams = ruleById(lowered.ruleSet.sinks, "sink.harmony.axios.call.params.arg0.params");
    const getParams = ruleById(lowered.ruleSet.sinks, "sink.harmony.axios.get.params.arg1.params");
    const requestUrl = ruleById(lowered.ruleSet.sinks, "sink.harmony.axios.request.url.arg0.url");
    const requestData = ruleById(lowered.ruleSet.sinks, "sink.harmony.axios.request.body.arg0.data");
    const requestParams = ruleById(lowered.ruleSet.sinks, "sink.harmony.axios.request.params.arg0.params");

    assertAxiosScoped(callUrl);
    assertAxiosScoped(callData);
    assertAxiosScoped(callParams);
    assertAxiosScoped(getParams);
    assertAxiosScoped(requestUrl);
    assertAxiosScoped(requestData);
    assertAxiosScoped(requestParams);

    assert(callUrl.match.value === "axios", `call URL selector drifted: ${callUrl.match.value}`);
    assert(callData.match.value === "axios", `call data selector drifted: ${callData.match.value}`);
    assert(callParams.match.value === "axios", `call params selector drifted: ${callParams.match.value}`);
    assert(getParams.match.value === "get", `get params selector drifted: ${getParams.match.value}`);
    assert(requestUrl.match.value === "request", `request URL selector drifted: ${requestUrl.match.value}`);
    assert(requestData.match.value === "request", `request data selector drifted: ${requestData.match.value}`);
    assert(requestParams.match.value === "request", `request params selector drifted: ${requestParams.match.value}`);

    assert(endpointKey(callUrl.target) === "arg0.url", `call URL endpoint drifted: ${endpointKey(callUrl.target)}`);
    assert(endpointKey(callData.target) === "arg0.data", `call data endpoint drifted: ${endpointKey(callData.target)}`);
    assert(endpointKey(callParams.target) === "arg0.params", `call params endpoint drifted: ${endpointKey(callParams.target)}`);
    assert(endpointKey(getParams.target) === "arg1.params", `get params endpoint drifted: ${endpointKey(getParams.target)}`);
    assert(endpointKey(requestUrl.target) === "arg0.url", `request URL endpoint drifted: ${endpointKey(requestUrl.target)}`);
    assert(endpointKey(requestData.target) === "arg0.data", `request data endpoint drifted: ${endpointKey(requestData.target)}`);
    assert(endpointKey(requestParams.target) === "arg0.params", `request params endpoint drifted: ${endpointKey(requestParams.target)}`);

    console.log("PASS test_axios_config_sink_contract");
}

main();
