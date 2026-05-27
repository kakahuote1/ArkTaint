import {
    type AssetDocumentBase,
    type HandoffHandleTemplate,
    type SemanticEffectInstance,
} from "../../core/assets/schema";
import {
    HandoffEffectConsumer,
    instantiateHandoffHandleTemplate,
    RuleEffectConsumer,
    SemanticRuntime,
} from "../../core/assets/runtime";
import { lowerModuleAssetToInternalModuleLoweringIR } from "../../core/kernel/contracts/ModuleAssetLowering";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function handoffInstance(kind: SemanticEffectInstance["kind"]): SemanticEffectInstance {
    return {
        id: `effect.${kind}`,
        kind,
        modelId: "asset.module.cache",
        bindingId: "binding.cache",
        templateId: "template.cache",
        surfaceId: "surface.cache",
        programPoint: {
            methodSignature: "Cache.save",
            stmtId: "1",
        },
        methodSignature: "Cache.save",
        location: { file: "Cache.ets", line: 1 },
        resolvedEndpoints: [],
        payload: {},
        originStatus: "official",
        confidence: "certain",
    };
}

function main(): void {
    const exactTemplate: HandoffHandleTemplate = {
        cellKind: "keyed-semantic-slot",
        family: "project.storage_box",
        key: [{ kind: "const", value: "token" }],
    };
    const exact = instantiateHandoffHandleTemplate(exactTemplate, () => undefined);
    assert(exact.cellKind === "keyed-semantic-slot", "handle should preserve explicit cellKind");
    assert(exact.precision === "exact", `const handle should be exact, got ${exact.precision}`);
    assert(exact.key[0] === "token", "const handle should keep literal key");

    const literalArgTemplate: HandoffHandleTemplate = {
        cellKind: "keyed-semantic-slot",
        family: "project.storage_box",
        key: [{ kind: "fromLiteralArg", index: 0 }],
    };
    const literalArg = instantiateHandoffHandleTemplate(literalArgTemplate, endpoint => {
        if (endpoint.base.kind === "arg" && endpoint.base.index === 0) return "session";
        return undefined;
    });
    assert(literalArg.precision === "exact", `resolved literal arg should be exact, got ${literalArg.precision}`);
    assert(literalArg.key[0] === "session", "resolved literal arg should become key value");

    const unknownArg = instantiateHandoffHandleTemplate(literalArgTemplate, () => undefined);
    assert(unknownArg.precision === "unknown", `unresolved single key should be unknown, got ${unknownArg.precision}`);

    const partialTemplate: HandoffHandleTemplate = {
        cellKind: "message-channel-slot",
        family: "project.event_bus",
        scope: [{ kind: "const", value: "owner" }],
        key: [{ kind: "fromLiteralArg", index: 0 }],
    };
    const partial = instantiateHandoffHandleTemplate(partialTemplate, () => undefined);
    assert(partial.precision === "partial", `mixed known/unknown parts should be partial, got ${partial.precision}`);

    const consumer = new HandoffEffectConsumer();
    assert(consumer.mode === "during-fixpoint", "handoff consumer must be during-fixpoint");
    assert(consumer.accepts("handoff.put"), "handoff consumer should accept put");
    assert(consumer.accepts("handoff.get"), "handoff consumer should accept get");
    assert(consumer.accepts("handoff.kill"), "handoff consumer should accept kill");
    assert(consumer.accepts("handoff.link"), "handoff consumer should accept link");
    assert(!consumer.accepts("rule.source"), "handoff consumer must not accept rule effects");

    const runtime = new SemanticRuntime([consumer]);
    try {
        runtime.consumeBatch([handoffInstance("handoff.put")]);
        throw new Error("expected batch handoff consumption to fail");
    } catch (error) {
        assert(String(error).includes("cannot batch-consume"), `unexpected batch handoff error: ${error}`);
    }

    const mixedRuntime = new SemanticRuntime([consumer, new RuleEffectConsumer()]);
    try {
        mixedRuntime.consumeBatch([handoffInstance("handoff.put")]);
        throw new Error("expected batch handoff consumption to fail even with rule consumer present");
    } catch (error) {
        assert(String(error).includes("cannot batch-consume"), `unexpected mixed runtime error: ${error}`);
    }

    const asset: AssetDocumentBase = {
        id: "asset.module.project.storage_box",
        plane: "module",
        status: "reviewed",
        surfaces: [
            invokeSurface("surface.save", "StorageBox", "save", 2),
            invokeSurface("surface.load", "StorageBox", "load", 1),
            invokeSurface("surface.remove", "StorageBox", "remove", 1),
        ],
        bindings: [
            handoffBinding("binding.save", "surface.save", ["template.save"]),
            handoffBinding("binding.load", "surface.load", ["template.load"]),
            handoffBinding("binding.remove", "surface.remove", ["template.remove"]),
        ],
        effectTemplates: [
            {
                id: "template.save",
                kind: "handoff.put",
                handle: firstArgWrapperHandle(),
                value: { base: { kind: "arg", index: 1 } },
            },
            {
                id: "template.load",
                kind: "handoff.get",
                handle: firstArgWrapperHandle(),
                target: { base: { kind: "return" } },
            },
            {
                id: "template.remove",
                kind: "handoff.kill",
                handle: firstArgWrapperHandle(),
            },
        ],
        provenance: {
            source: "manual",
            evidenceLocations: [{ file: "StorageBox.ets", line: 1 }],
            createdAt: "2026-05-27T00:00:00.000Z",
        },
    };
    const lowered = lowerModuleAssetToInternalModuleLoweringIR(asset);
    assert(lowered.semantics.length === 1, `expected one keyed storage semantic, got ${lowered.semantics.length}`);
    const keyed = lowered.semantics[0] as any;
    assert(keyed.kind === "keyed_storage", `expected keyed_storage, got ${keyed.kind}`);
    assert(keyed.storageClasses.includes("StorageBox"), "expected StorageBox storage class");
    assert(keyed.writeMethods.some((item: any) => item.methodName === "save" && item.valueIndex === 1), "expected save write method");
    assert(keyed.readMethods.includes("load"), "expected load read method");
    assert(keyed.killMethods.includes("remove"), "expected remove kill method");

    console.log("PASS test_handoff_effect_consumer_v2");
}

function invokeSurface(surfaceId: string, ownerName: string, methodName: string, argCount: number): AssetDocumentBase["surfaces"][number] {
    return {
        surfaceId,
        kind: "invoke",
        modulePath: "project/storage",
        ownerName,
        methodName,
        invokeKind: "instance",
        argCount,
        confidence: "certain",
        provenance: {
            source: "analyzer",
            location: { file: "StorageBox.ets", line: 1 },
        },
    };
}

function handoffBinding(bindingId: string, surfaceId: string, effectTemplateRefs: string[]): AssetDocumentBase["bindings"][number] {
    return {
        bindingId,
        assetId: "asset.module.project.storage_box",
        surfaceId,
        plane: "module",
        role: "handoff",
        effectTemplateRefs,
        semanticsFamily: "project-keyed-storage",
        completeness: "partial",
        confidence: "certain",
    };
}

function firstArgWrapperHandle(): HandoffHandleTemplate {
    return {
        cellKind: "keyed-semantic-slot",
        family: "project.storage_box",
        key: [{ kind: "fromLiteralArg", index: 0 }],
        precision: "infer",
    };
}

main();
