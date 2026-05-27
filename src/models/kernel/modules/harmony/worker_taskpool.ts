import { createBuiltinModuleAsset, moduleInvokeSurface } from "../../moduleAssetHelpers";

const harmonyWorkerTaskPoolModuleAsset = createBuiltinModuleAsset({
    id: "harmony.worker_taskpool",
    description: "Built-in Harmony Worker/TaskPool forward bridges.",
    semanticsFamily: "harmony-worker-taskpool",
    role: "handoff",
    capability: "module.bridge",
    surfaces: [
        moduleInvokeSurface("harmony.worker_taskpool.Worker.postMessage", "Worker", "postMessage", 1, "instance", "@ohos.worker"),
        moduleInvokeSurface("harmony.worker_taskpool.Worker.onMessage", "Worker", "onMessage", 1, "instance", "@ohos.worker"),
        moduleInvokeSurface("harmony.worker_taskpool.taskpool.execute", "taskpool", "execute", 2, "namespace", "@ohos.taskpool"),
    ],
    payload: {
        bridge: {
            from: {
                surface: {
                    kind: "invoke",
                    selector: {
                        methodName: "postMessage",
                        minArgs: 1,
                        instanceOnly: true,
                    },
                },
                slot: "arg",
                index: 0,
            },
            to: {
                surface: {
                    kind: "invoke",
                    selector: {
                        methodName: "onMessage",
                        minArgs: 1,
                        instanceOnly: true,
                    },
                },
                slot: "callback_param",
                callbackArgIndex: 0,
                paramIndex: 0,
            },
            constraints: [{ kind: "same_receiver" }],
            emit: {
                reason: "Harmony-WorkerTaskPool",
                allowUnreachableTarget: true,
            },
            dispatch: {
                reason: "Harmony-WorkerTaskPool",
                preset: "callback_event",
            },
        },
    },
});

const harmonyTaskPoolExecuteModuleAsset = createBuiltinModuleAsset({
    id: "harmony.taskpool_execute",
    description: "Built-in Harmony TaskPool execute payload bridge.",
    semanticsFamily: "harmony-worker-taskpool",
    role: "handoff",
    capability: "module.bridge",
    surfaces: [
        moduleInvokeSurface("harmony.taskpool_execute.taskpool.execute", "taskpool", "execute", 2, "namespace", "@ohos.taskpool"),
    ],
    payload: {
        bridge: {
            from: {
                surface: {
                    kind: "invoke",
                    selector: {
                        methodName: "execute",
                        declaringClassIncludes: "taskpool",
                        minArgs: 2,
                    },
                },
                slot: "arg",
                index: 1,
            },
            to: {
                surface: {
                    kind: "invoke",
                    selector: {
                        methodName: "execute",
                        declaringClassIncludes: "taskpool",
                        minArgs: 2,
                    },
                },
                slot: "callback_param",
                callbackArgIndex: 0,
                paramIndex: 0,
            },
            emit: {
                reason: "Harmony-WorkerTaskPool",
                allowUnreachableTarget: true,
            },
            dispatch: {
                reason: "Harmony-WorkerTaskPool",
                preset: "callback_sync",
            },
        },
    },
});

export default [
    harmonyWorkerTaskPoolModuleAsset,
    harmonyTaskPoolExecuteModuleAsset,
];
