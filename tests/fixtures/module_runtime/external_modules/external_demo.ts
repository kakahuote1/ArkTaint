import { defineModule } from "../../../../src/core/kernel/contracts/ModuleContract";

export default defineModule({
    id: "external.custom_pack",
    description: "External module fixture.",
    setup() {
        return {
            onFact() {
                return undefined;
            },
        };
    },
});
