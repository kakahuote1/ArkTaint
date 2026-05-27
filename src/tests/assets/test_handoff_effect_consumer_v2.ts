import {
    type HandoffHandleTemplate,
    type SemanticEffectInstance,
} from "../../core/assets/schema";
import {
    HandoffEffectConsumer,
    instantiateHandoffHandleTemplate,
    RuleEffectConsumer,
    SemanticRuntime,
} from "../../core/assets/runtime";

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
        family: "wrapper",
        key: [{ kind: "const", value: "token" }],
    };
    const exact = instantiateHandoffHandleTemplate(exactTemplate, () => undefined);
    assert(exact.precision === "exact", `const handle should be exact, got ${exact.precision}`);
    assert(exact.key[0] === "token", "const handle should keep literal key");

    const literalArgTemplate: HandoffHandleTemplate = {
        family: "wrapper",
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
        family: "event",
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

    console.log("PASS test_handoff_effect_consumer_v2");
}

main();
