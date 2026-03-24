import { defineSemanticPack, SemanticPack } from "../../core/kernel/contracts/SemanticPack";
import { emitNodeFactsByIds } from "../../core/kernel/contracts/PackEmissionUtils";

export const harmonyEmitterPack: SemanticPack = defineSemanticPack({
    id: "harmony.emitter",
    description: "Built-in Harmony event emitter bridges.",
    setup(ctx) {
        const { buildEmitterModel } = require("./EmitterModeling") as typeof import("./EmitterModeling");
        const model = buildEmitterModel({
            scene: ctx.scene,
            pag: ctx.pag,
            allowedMethodSignatures: ctx.allowedMethodSignatures,
            queries: ctx.queries,
        });
        if (model.onRegistrationCount > 0 || model.emitCount > 0) {
            ctx.log(
                `[Harmony-Emitter] on_registrations=${model.onRegistrationCount}, `
                + `emits=${model.emitCount}, `
                + `bridge_edges=${model.bridgeCount}, `
                + `dynamic_event_skips=${model.dynamicEventSkipCount}`,
            );
        }
        return {
            onFact(event) {
                const targetNodeIds = model.forwardTargetNodeIdsBySourceNodeId.get(event.node.getID());
                if (!targetNodeIds || targetNodeIds.size === 0) return;
                return emitNodeFactsByIds(
                    event.pag,
                    targetNodeIds,
                    event.fact.source,
                    event.fact.contextID,
                    "Harmony-Emitter",
                    event.fact.field,
                );
            },
        };
    },
});

export default harmonyEmitterPack;
