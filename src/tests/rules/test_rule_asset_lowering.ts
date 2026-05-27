import {
    AssetDocumentBase,
    AssetEndpoint,
} from "../../core/assets/schema";
import { lowerRuleAssetsToRuleSet } from "../../core/rules/RuleAssetLowering";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

const arg0: AssetEndpoint = { base: { kind: "arg", index: 0 } };
const arg1: AssetEndpoint = { base: { kind: "arg", index: 1 } };
const resultEndpoint: AssetEndpoint = { base: { kind: "return" } };

function ruleAsset(): AssetDocumentBase {
    return {
        id: "asset.rule.test",
        plane: "rule",
        status: "official",
        surfaces: [
            {
                surfaceId: "surface.token.cache",
                kind: "invoke",
                modulePath: "project/token",
                ownerName: "TokenCache",
                methodName: "save",
                invokeKind: "instance",
                argCount: 2,
                confidence: "certain",
                provenance: { source: "manual" },
            },
        ],
        bindings: [
            {
                bindingId: "binding.source.result",
                surfaceId: "surface.token.cache",
                assetId: "asset.rule.test",
                plane: "rule",
                role: "source",
                selector: {
                    kind: "method-name-equals",
                    value: "load",
                    invokeKind: "instance",
                    argCount: 1,
                    scope: { className: { mode: "equals", value: "TokenCache" } },
                },
                endpoint: resultEndpoint,
                effectTemplateRefs: ["template.source.result"],
                semanticsFamily: "credential-source",
                metadata: {
                    severity: "high",
                    category: "credential",
                    layer: "kernel",
                    tier: "A",
                },
                completeness: "complete",
                confidence: "certain",
            },
            {
                bindingId: "binding.sink.arg0",
                surfaceId: "surface.token.cache",
                assetId: "asset.rule.test",
                plane: "rule",
                role: "sink",
                selector: {
                    kind: "signature-contains",
                    value: "Logger.info",
                },
                endpoint: arg0,
                effectTemplateRefs: ["template.sink.arg0"],
                semanticsFamily: "privacy-log",
                completeness: "complete",
                confidence: "certain",
            },
            {
                bindingId: "binding.transfer.arg1.to.slot",
                surfaceId: "surface.token.cache",
                assetId: "asset.rule.test",
                plane: "rule",
                role: "transfer",
                selector: {
                    kind: "signature-contains",
                    value: "Map.set",
                    invokeKind: "instance",
                    argCount: 2,
                },
                endpoint: { base: { kind: "receiver" } },
                effectTemplateRefs: ["template.transfer.arg1.to.slot"],
                semanticsFamily: "container-transfer",
                completeness: "complete",
                confidence: "certain",
            },
        ],
        effectTemplates: [
            {
                id: "template.source.result",
                kind: "rule.source",
                value: resultEndpoint,
                sourceKind: "call_return",
                confidence: "certain",
            },
            {
                id: "template.sink.arg0",
                kind: "rule.sink",
                value: arg0,
                sinkKind: "log",
                confidence: "certain",
            },
            {
                id: "template.transfer.arg1.to.slot",
                kind: "rule.transfer",
                from: arg1,
                to: {
                    endpoint: { base: { kind: "receiver" } },
                    pathFrom: arg0,
                    slotKind: "map",
                },
                transferKind: "map-slot",
                confidence: "certain",
            },
        ],
        provenance: { source: "builtin" },
    };
}

function main(): void {
    const lowered = lowerRuleAssetsToRuleSet([ruleAsset()]);
    assert(lowered.diagnostics.length === 0, `unexpected diagnostics: ${lowered.diagnostics.join("; ")}`);
    assert(lowered.ruleSet.sources.length === 1, "source should be lowered");
    assert(lowered.ruleSet.sinks.length === 1, "sink should be lowered");
    assert(lowered.ruleSet.transfers.length === 1, "transfer should be lowered");

    const source = lowered.ruleSet.sources[0];
    assert(source.match.kind === "method_name_equals", "selector should lower to old rule matcher");
    assert(source.sourceKind === "call_return", "source kind should be preserved");
    assert(source.target === "result", "return endpoint should lower to result");
    assert(source.category === "credential", "metadata category should be preserved");
    assert(source.severity === "high", "metadata severity should be preserved");

    const sink = lowered.ruleSet.sinks[0];
    assert(sink.match.kind === "signature_contains", "signature selector should be preserved");
    assert(sink.target === "arg0", "arg endpoint should lower to arg0");

    const bindingEndpointAsset = ruleAsset();
    const bindingEndpointSinkTemplate = bindingEndpointAsset.effectTemplates!.find(template => template.id === "template.sink.arg0") as any;
    delete bindingEndpointSinkTemplate.value;
    bindingEndpointAsset.bindings[1].endpoint = arg0;
    const loweredFromBindingEndpoint = lowerRuleAssetsToRuleSet([bindingEndpointAsset]);
    assert(loweredFromBindingEndpoint.diagnostics.length === 0, "binding endpoint fallback should not produce diagnostics");
    assert(
        loweredFromBindingEndpoint.ruleSet.sinks[0].target === "arg0",
        "rule.sink without template value should lower from binding.endpoint",
    );

    const transfer = lowered.ruleSet.transfers[0];
    assert(transfer.from === "arg1", "transfer from endpoint should lower");
    assert(typeof transfer.to === "object", "slot transfer target should be object ref");
    assert(transfer.to.endpoint === "base", "slot target should lower to base endpoint");
    assert(transfer.to.pathFrom === "arg0", "slot path source should lower to pathFrom");
    assert(transfer.to.slotKind === "map", "slot kind should lower");

    const missingSelectorAsset = ruleAsset();
    missingSelectorAsset.bindings[0].selector = undefined;
    missingSelectorAsset.surfaces[0] = {
        ...(missingSelectorAsset.surfaces[0] as any),
        methodName: "load",
        argCount: 1,
    };
    const inferred = lowerRuleAssetsToRuleSet([missingSelectorAsset]);
    assert(inferred.diagnostics.length === 0, "invoke surface should provide fallback selector");
    assert(inferred.ruleSet.sources[0].match.value === "load", "fallback selector should use invoke surface method");
    assert(inferred.ruleSet.sources[0].scope === undefined, "surface fallback must not constrain the caller scope");
    assert(
        inferred.ruleSet.sources[0].calleeScope?.className?.value === "TokenCache",
        "surface fallback should constrain the callee owner through calleeScope",
    );

    console.log("PASS test_rule_asset_lowering");
}

main();
