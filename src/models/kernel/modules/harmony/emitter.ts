import type { ModuleSpec } from "../../../../core/kernel/contracts/ModuleSpec";

const harmonyEmitterModuleSpec: ModuleSpec = {
    id: "harmony.emitter",
    description: "Built-in Harmony event emitter bridges.",
    semantics: [
        {
            id: "event_emitter",
            kind: "event_emitter",
            onMethods: ["on"],
            emitMethods: ["emit"],
            maxCandidates: 8,
        },
    ],
};

export default harmonyEmitterModuleSpec;

