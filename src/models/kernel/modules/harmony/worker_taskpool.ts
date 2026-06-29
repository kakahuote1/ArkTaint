import { createBuiltinModuleAsset } from "../../moduleAssetHelpers";
import { officialInvokeSurfaceFromId } from "../../moduleAssetHelpers";

const taskpoolExecuteCanonicalApiIds = [
    "api:official:openharmony:module=%40ohos.taskpool:file=api%2F%40ohos.taskpool.d.ts:export=default%3Ataskpool:decl=namespace%3Ataskpool:member=function%3Aexecute:invoke=call:params=0%3A(...args%3A%20A)%20%3D%3E%20R%20%7C%20Promise%3CR%3E%2C1%3Arest%3AA:ret=Promise%3CR%3E",
    "api:official:openharmony:module=%40ohos.taskpool:file=api%2F%40ohos.taskpool.d.ts:export=default%3Ataskpool:decl=namespace%3Ataskpool:member=function%3Aexecute:invoke=call:params=0%3AFunction%2C1%3Arest%3AObject%5B%5D:ret=Promise%3CObject%3E",
];

const taskpoolExecuteAssets = taskpoolExecuteCanonicalApiIds.map((canonicalApiId, index) => createBuiltinModuleAsset({
    id: `harmony.taskpool_execute.${String(index + 1).padStart(4, "0")}`,
    description: "Built-in Harmony TaskPool execute payload bridge.",
    semanticsFamily: "harmony-worker-taskpool",
    role: "handoff",
    capability: "module.bridge",
    surfaces: [canonicalApiId].map(officialInvokeSurfaceFromId),
    payload: {
        bridge: {
            from: {
                surface: { canonicalApiId },
                slot: "arg",
                index: 1,
                rest: true,
            },
            to: {
                surface: { canonicalApiId },
                slot: "callback_param",
                callbackArgIndex: 0,
                paramIndex: 0,
                rest: true,
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
}));

export default taskpoolExecuteAssets;
