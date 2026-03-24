import { defineSemanticPack } from "../../../../src/core/kernel/contracts/SemanticPack";

export default defineSemanticPack({
    id: "external.custom_pack",
    description: "External semantic pack fixture.",
    setup() {
        return {
            onFact() {
                return undefined;
            },
        };
    },
});
