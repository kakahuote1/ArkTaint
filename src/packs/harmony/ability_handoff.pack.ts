import { defineSemanticPack, SemanticPack } from "../../core/kernel/contracts/SemanticPack";
import { emitNodeFactsByIds } from "../../core/kernel/contracts/PackEmissionUtils";

export const harmonyAbilityHandoffPack: SemanticPack = defineSemanticPack({
    id: "harmony.ability_handoff",
    description: "Built-in Harmony Ability handoff bridges.",
    setup(ctx) {
        const { buildAbilityHandoffModel } = require("./AbilityHandoffModeling") as typeof import("./AbilityHandoffModeling");
        const model = buildAbilityHandoffModel({
            scene: ctx.scene,
            pag: ctx.pag,
            allowedMethodSignatures: ctx.allowedMethodSignatures,
        });
        if (model.callCount > 0) {
            ctx.log(
                `[Harmony-AbilityHandoff] calls=${model.callCount}, `
                + `targets=${model.targetMethodCount}, `
                + `boundary=${model.boundary.kind}`,
            );
        }
        return {
            onFact(event) {
                const targetNodeIds = model.targetNodeIdsBySourceNodeId.get(event.node.getID());
                if (!targetNodeIds || targetNodeIds.size === 0) return;
                const field = model.boundary.preservesFieldPath
                    ? event.fact.field
                    : undefined;
                return emitNodeFactsByIds(
                    event.pag,
                    targetNodeIds,
                    event.fact.source,
                    event.fact.contextID,
                    "Harmony-AbilityHandoff",
                    field,
                );
            },
        };
    },
});

export default harmonyAbilityHandoffPack;
