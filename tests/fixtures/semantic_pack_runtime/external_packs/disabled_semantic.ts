import { defineSemanticPack } from "../../../../src/core/kernel/contracts/SemanticPack";

export default defineSemanticPack({
    id: "external.disabled_pack",
    description: "Disabled external semantic pack fixture.",
    enabled: false,
    setup() {
        return {
            onFact() {
                throw new Error("disabled external semantic pack should not run");
            },
        };
    },
});
