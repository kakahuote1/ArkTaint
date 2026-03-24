import { defineSemanticPack, SemanticPack } from "../../core/kernel/contracts/SemanticPack";
import { emitNodeFactsByIds } from "../../core/kernel/contracts/PackEmissionUtils";

export const harmonyWorkerTaskPoolPack: SemanticPack = defineSemanticPack({
    id: "harmony.worker_taskpool",
    description: "Built-in Harmony Worker/TaskPool forward bridges.",
    setup(ctx) {
        const { buildWorkerTaskPoolModel } = require("./WorkerTaskPoolModeling") as typeof import("./WorkerTaskPoolModeling");
        const model = buildWorkerTaskPoolModel({
            scene: ctx.scene,
            pag: ctx.pag,
            allowedMethodSignatures: ctx.allowedMethodSignatures,
            queries: ctx.queries,
        });
        if (model.bridgeCount > 0) {
            ctx.log(
                `[Harmony-WorkerTaskPool] bridge_edges=${model.bridgeCount}, `
                + `worker_registrations=${model.workerRegistrationCount}, `
                + `worker_sends=${model.workerSendCount}, `
                + `taskpool_executes=${model.taskpoolExecuteCount}`,
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
                    "Harmony-WorkerTaskPool",
                    event.fact.field,
                );
            },
        };
    },
});

export default harmonyWorkerTaskPoolPack;
