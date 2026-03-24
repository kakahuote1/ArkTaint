import { defineSemanticPack } from "../../../src/core/kernel/contracts/SemanticPack";

export default defineSemanticPack({
    id: "example.demo_pack",
    description: "Minimal demo semantic pack.",
    setup() {
        return {
            onFact() {
                return undefined;
            },
        };
    },
});
