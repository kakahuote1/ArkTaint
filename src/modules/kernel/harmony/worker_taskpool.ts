import { defineModule, TaintModule } from "../../../core/kernel/contracts/ModuleApi";

interface WorkerRegistration {
    workerObjectNodeIds: Set<number>;
    callbackParamNodeIds: Set<number>;
}

interface WorkerSend {
    workerObjectNodeIds: Set<number>;
    payloadNodeIds: Set<number>;
}

export const harmonyWorkerTaskPoolModule: TaintModule = defineModule({
    id: "harmony.worker_taskpool",
    description: "Built-in Harmony Worker/TaskPool forward bridges.",
    setup(ctx) {
        const relay = ctx.bridge.nodeRelay();
        const workerRegistrations: WorkerRegistration[] = [];
        const workerSends: WorkerSend[] = [];
        const allWorkerCallbackParamNodeIds = new Set<number>();
        let workerRegistrationCount = 0;
        let workerSendCount = 0;
        let taskpoolExecuteCount = 0;
        let bridgeEdgeCount = 0;

        for (const call of ctx.scan.invokes({ methodName: "onMessage", instanceOnly: true, minArgs: 1 })) {
            const callbackParamNodeIds = new Set<number>(call.callbackParamNodeIds(0, 0, { maxCandidates: 8 }));
            if (callbackParamNodeIds.size === 0) continue;
            const workerObjectNodeIds = new Set<number>(call.baseCarrierNodeIds());
            if (workerObjectNodeIds.size === 0) continue;
            workerRegistrationCount++;
            workerRegistrations.push({
                workerObjectNodeIds,
                callbackParamNodeIds,
            });
            for (const nodeId of callbackParamNodeIds) {
                allWorkerCallbackParamNodeIds.add(nodeId);
            }
        }

        for (const call of ctx.scan.invokes({ methodName: "postMessage", instanceOnly: true, minArgs: 1 })) {
            const payloadNodeIds = new Set<number>(call.argNodeIds(0));
            if (payloadNodeIds.size === 0) continue;
            const workerObjectNodeIds = new Set<number>(call.baseCarrierNodeIds());
            if (workerObjectNodeIds.size === 0) continue;
            workerSendCount++;
            workerSends.push({
                workerObjectNodeIds,
                payloadNodeIds,
            });
        }

        for (const call of ctx.scan.invokes({
            methodName: "execute",
            declaringClassIncludes: "taskpool",
            minArgs: 2,
        })) {
            const callbackParamNodeIds = new Set<number>(call.callbackParamNodeIds(0, 0, { maxCandidates: 8 }));
            if (callbackParamNodeIds.size === 0) continue;
            const payloadNodeIds = new Set<number>(call.argNodeIds(1));
            if (payloadNodeIds.size === 0) continue;
            taskpoolExecuteCount++;
            bridgeEdgeCount += payloadNodeIds.size * callbackParamNodeIds.size;
            relay.connectMany(payloadNodeIds, callbackParamNodeIds);
        }

        for (const send of workerSends) {
            const matchedTargets = new Set<number>();
            for (const registration of workerRegistrations) {
                if (!hasIntersection(send.workerObjectNodeIds, registration.workerObjectNodeIds)) continue;
                for (const targetNodeId of registration.callbackParamNodeIds) {
                    matchedTargets.add(targetNodeId);
                }
            }
            const finalTargets = matchedTargets.size > 0
                ? matchedTargets
                : allWorkerCallbackParamNodeIds;
            bridgeEdgeCount += send.payloadNodeIds.size * finalTargets.size;
            relay.connectMany(send.payloadNodeIds, finalTargets);
        }

        ctx.debug.summary("Harmony-WorkerTaskPool", {
            bridge_edges: bridgeEdgeCount,
            worker_registrations: workerRegistrationCount,
            worker_sends: workerSendCount,
            taskpool_executes: taskpoolExecuteCount,
        });

        return {
            onFact(event) {
                return relay.emitPreserve(event, "Harmony-WorkerTaskPool");
            },
        };
    },
});

function hasIntersection(a: Set<number>, b: Set<number>): boolean {
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    for (const value of small) {
        if (large.has(value)) return true;
    }
    return false;
}

export default harmonyWorkerTaskPoolModule;
