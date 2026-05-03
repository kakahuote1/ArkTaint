import type { ModuleSpec } from "../../../../core/kernel/contracts/ModuleSpec";

const tsjsContainerModuleSpec: ModuleSpec = {
    id: "tsjs.container",
    description: "Built-in TS/JS container and collection semantics.",
    semantics: [
        {
            id: "container",
            kind: "container",
        },
    ],
};

export default tsjsContainerModuleSpec;
