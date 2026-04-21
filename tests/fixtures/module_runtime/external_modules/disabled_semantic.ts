import { defineModule } from "../../../../src/core/kernel/contracts/ModuleContract";

export default defineModule({
    id: "external.disabled_pack",
    description: "Disabled external module fixture.",
    enabled: false,
    setup() {
        return {
            onFact() {
                throw new Error("disabled external module should not run");
            },
        };
    },
});
