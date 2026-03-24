import { defineSemanticPack } from "../../../../src/core/kernel/contracts/SemanticPack";

export default defineSemanticPack({
    id: "fixture.runtime",
    description: "Runtime fixture semantic pack.",
    setup() {
        return {
            onFact(event) {
                if (!event.node || typeof event.node.getID !== "function" || event.node.getID() !== 7) {
                    return;
                }
                return [
                    {
                        reason: "Fixture-Pack",
                        fact: new event.fact.constructor(event.node, event.fact.source, event.fact.contextID, ["pack"]),
                    },
                ];
            },
            onInvoke(event) {
                if (event.callSignature !== "fixture.call") {
                    return;
                }
                return [
                    {
                        reason: "Fixture-Invoke",
                        fact: new event.fact.constructor(event.node, event.fact.source, event.fact.contextID, ["invoke"]),
                    },
                ];
            },
            shouldSkipCopyEdge(event) {
                return event.contextId === 7;
            },
        };
    },
});

export const disabledInline = defineSemanticPack({
    id: "fixture.runtime.disabled_inline",
    description: "Disabled inline semantic pack fixture.",
    enabled: false,
    setup() {
        return {
            onFact() {
                throw new Error("disabled inline semantic pack should not run");
            },
        };
    },
});
