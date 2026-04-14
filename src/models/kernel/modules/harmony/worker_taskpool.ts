import type { ModuleSpec } from "../../../../core/kernel/contracts/ModuleSpec";

const harmonyWorkerTaskPoolModuleSpec: ModuleSpec = {
    id: "harmony.worker_taskpool",
    description: "Built-in Harmony Worker/TaskPool forward bridges.",
    semantics: [
        {
            id: "worker_message_channel",
            kind: "bridge",
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
            constraints: [
                {
                    kind: "same_receiver",
                },
            ],
            emit: {
                reason: "Harmony-WorkerTaskPool",
                allowUnreachableTarget: true,
            },
            dispatch: {
                reason: "Harmony-WorkerTaskPool",
                preset: "callback_event",
            },
        },
        {
            id: "taskpool_execute_payload",
            kind: "bridge",
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
    ],
};

export default harmonyWorkerTaskPoolModuleSpec;

