import { defineSemanticPack, SemanticPack, SemanticPackEmission, TaintFact } from "../../core/kernel/contracts/SemanticPack";
import { emitNodeFactsByIds } from "../../core/kernel/contracts/PackEmissionUtils";

export const harmonyStatePack: SemanticPack = defineSemanticPack({
    id: "harmony.state",
    description: "Built-in Harmony state/prop/link/provide-consume bridges.",
    setup(ctx) {
        const { buildStateManagementModel } = require("./StateManagementModeling") as typeof import("./StateManagementModeling");
        const model = buildStateManagementModel({
            scene: ctx.scene,
            pag: ctx.pag,
            allowedMethodSignatures: ctx.allowedMethodSignatures,
            queries: ctx.queries,
        });
        if (model.bridgeEdgeCount > 0 || model.eventInvokeBridgeCount > 0) {
            ctx.log(
                `[Harmony-State] bridge_edges=${model.bridgeEdgeCount}, `
                + `constructor_calls=${model.constructorCallCount}, `
                + `state_capture_fields=${model.stateCaptureAssignCount}, `
                + `event_invoke_bridges=${model.eventInvokeBridgeCount}`,
            );
        }
        return {
            onFact(event) {
                const emissions: SemanticPackEmission[] = [];
                const dedup = new Set<string>();
                const push = (reason: string, fact: TaintFact): void => {
                    const key = `${reason}|${fact.id}`;
                    if (dedup.has(key)) return;
                    dedup.add(key);
                    emissions.push({ reason, fact });
                };

                const eventTargets = model.eventInvokeBridges.get(event.node.getID());
                if (eventTargets && eventTargets.size > 0) {
                    for (const emission of emitNodeFactsByIds(
                        event.pag,
                        eventTargets,
                        event.fact.source,
                        event.fact.contextID,
                        "Harmony-StateEvent",
                        event.fact.field,
                    )) {
                        const key = `${emission.reason}|${emission.fact.id}`;
                        if (dedup.has(key)) continue;
                        dedup.add(key);
                        emissions.push({
                            reason: emission.reason,
                            fact: emission.fact,
                            allowUnreachableTarget: true,
                        });
                    }
                }

                if (event.fact.field && event.fact.field.length > 0) {
                    const sourceFieldName = event.fact.field[0];
                    const sourceKey = `${event.node.getID()}#${sourceFieldName}`;
                    const bridgeEdges = model.edgesBySourceField.get(sourceKey) || [];
                    for (const edge of bridgeEdges) {
                        const targetObjectNode = event.pag.getNode(edge.targetObjectNodeId) as any;
                        if (!targetObjectNode) continue;
                        const targetFieldPath = event.fact.field.length > 1
                            ? [edge.targetFieldName, ...event.fact.field.slice(1)]
                            : [edge.targetFieldName];
                        push(
                            "Harmony-StateProp",
                            new TaintFact(
                                targetObjectNode,
                                event.fact.source,
                                event.fact.contextID,
                                targetFieldPath,
                            ),
                        );
                    }
                }

                return emissions.length > 0 ? emissions : undefined;
            },
        };
    },
});

export default harmonyStatePack;
