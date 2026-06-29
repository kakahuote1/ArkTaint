import {
    type AssetDocumentBase,
    type SemanticEffectConsumer,
    type SemanticEffectInstance,
    type ValidationResult,
    result,
    validateAssetDocument,
} from "../../core/assets/schema";
import {
    instantiateEffectTemplate,
    RuleEffectConsumer,
    SemanticRuntime,
} from "../../core/assets/runtime";
import { exactProjectInvokeSurface } from "../helpers/AssetIdentityTestUtils";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function asset(): AssetDocumentBase {
    const surface = exactProjectInvokeSurface({
        surfaceId: "surface.demo.api",
        modulePath: "@demo/api",
        ownerName: "Demo",
        methodName: "request",
        invokeKind: "static",
        parameterTypes: ["DemoRequest"],
        returnType: "SyntheticTaintValue",
    });
    return {
        id: "asset.rule.demo",
        plane: "rule",
        status: "official",
        surfaces: [surface],
        bindings: [
            {
                bindingId: "binding.demo.source",
                surfaceId: "surface.demo.api",
                assetId: "asset.rule.demo",
                plane: "rule",
                role: "source",
                canonicalApiId: surface.canonicalApiId,
                endpoint: { base: { kind: "return" } },
                effectTemplateRefs: ["template.demo.source"],
                completeness: "complete",
                confidence: "certain",
            },
            {
                bindingId: "binding.demo.sink",
                surfaceId: "surface.demo.api",
                assetId: "asset.rule.demo",
                plane: "rule",
                role: "sink",
                canonicalApiId: surface.canonicalApiId,
                endpoint: { base: { kind: "arg", index: 0 } },
                effectTemplateRefs: ["template.demo.sink"],
                completeness: "complete",
                confidence: "certain",
            },
            {
                bindingId: "binding.demo.transfer",
                surfaceId: "surface.demo.api",
                assetId: "asset.rule.demo",
                plane: "rule",
                role: "transfer",
                canonicalApiId: surface.canonicalApiId,
                endpoint: { base: { kind: "arg", index: 0 } },
                effectTemplateRefs: ["template.demo.transfer"],
                completeness: "complete",
                confidence: "certain",
            },
        ],
        effectTemplates: [
            {
                id: "template.demo.source",
                kind: "rule.source",
                value: { base: { kind: "return" } },
                sourceKind: "call_return",
                confidence: "certain",
            },
            {
                id: "template.demo.sink",
                kind: "rule.sink",
                value: { base: { kind: "arg", index: 0 } },
                sinkKind: "network-request",
                confidence: "certain",
            },
            {
                id: "template.demo.transfer",
                kind: "rule.transfer",
                from: { base: { kind: "arg", index: 0 } },
                to: { base: { kind: "return" } },
                transferKind: "identity",
                confidence: "certain",
            },
        ],
        provenance: { source: "builtin" },
    };
}

function instantiateAll(model: AssetDocumentBase): SemanticEffectInstance[] {
    const surface = model.surfaces[0];
    return model.bindings.map(binding => {
        const templateId = binding.effectTemplateRefs![0];
        const template = model.effectTemplates!.find(item => item.id === templateId)!;
        return instantiateEffectTemplate(model, surface, binding, template, {
            programPoint: {
                methodSignature: "Demo.request",
                stmtId: binding.bindingId,
            },
            methodSignature: "Demo.request",
            location: { file: "Demo.ets", line: 10 },
            resolvedEndpoints: [
                {
                    endpoint: binding.endpoint!,
                    valueRef: `${binding.bindingId}:value`,
                    status: "resolved",
                },
            ],
        });
    });
}

class DuplicateRuleConsumer extends RuleEffectConsumer {
    readonly family = "duplicate-rule";
}

class NoBatchConsumer implements SemanticEffectConsumer {
    readonly family = "no-batch";
    readonly mode = "pre-analysis" as const;
    accepts(kind: SemanticEffectInstance["kind"]): boolean {
        return kind === "rule.source";
    }
    validate(): ValidationResult {
        return result([]);
    }
}

function main(): void {
    const model = asset();
    const validation = validateAssetDocument(model);
    assert(validation.valid, `asset should validate: ${validation.errors.join("; ")}`);

    const instances = instantiateAll(model);
    assert(instances.length === 3, "expected three rule effect instances");
    assert(instances.every(instance => instance.modelId === model.id), "instances should carry model id");
    assert(instances.every(instance => instance.surfaceId === model.surfaces[0].surfaceId), "instances should carry surface id");
    assert(instances.every(instance => instance.location.file === "Demo.ets"), "instances should carry source location");

    const runtime = new SemanticRuntime([new RuleEffectConsumer()]);
    const emissions = runtime.consumeBatch(instances);
    const kinds = emissions.map(item => item.kind).sort();
    assert(kinds.join(",") === "analysis.sink,analysis.source,analysis.transfer", `unexpected emissions: ${kinds.join(",")}`);
    assert(emissions.every(item => item.effectInstanceId && item.modelId && item.bindingId && item.templateId), "emissions should keep provenance ids");

    const noConsumerRuntime = new SemanticRuntime([]);
    try {
        noConsumerRuntime.consumeBatch([instances[0]]);
        throw new Error("expected missing consumer to throw");
    } catch (error) {
        assert(String(error).includes("no semantic effect consumer"), `unexpected no-consumer error: ${error}`);
    }

    const duplicateRuntime = new SemanticRuntime([new RuleEffectConsumer(), new DuplicateRuleConsumer()]);
    try {
        duplicateRuntime.consumeBatch([instances[0]]);
        throw new Error("expected duplicate consumer to throw");
    } catch (error) {
        assert(String(error).includes("multiple semantic effect consumers"), `unexpected duplicate-consumer error: ${error}`);
    }

    const noBatchRuntime = new SemanticRuntime([new NoBatchConsumer()]);
    try {
        noBatchRuntime.consumeBatch([instances[0]]);
        throw new Error("expected no-batch consumer to throw");
    } catch (error) {
        assert(String(error).includes("cannot batch-consume"), `unexpected no-batch error: ${error}`);
    }

    console.log("PASS test_semantic_runtime_rule_effects");
}

main();
