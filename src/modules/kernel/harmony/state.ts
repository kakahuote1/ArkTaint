import type { ModuleSpec } from "../../../core/kernel/contracts/ModuleSpec";

const harmonyStateModuleSpec: ModuleSpec = {
    id: "harmony.state",
    description: "Built-in Harmony state/prop/link/provide-consume bridges.",
    semantics: [
        {
            id: "state_binding",
            kind: "state_binding",
            stateDecorators: ["State"],
            propDecorators: ["Prop", "Link", "ObjectLink", "Local", "Param", "Once", "Event", "Trace"],
            linkDecorators: ["Link", "ObjectLink", "Local", "Trace"],
            provideDecorators: ["Provide", "Provider"],
            consumeDecorators: ["Consume", "Consumer"],
            eventDecorators: ["Event"],
        },
    ],
};

export default harmonyStateModuleSpec;
