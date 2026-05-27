import { createBuiltinModuleAsset, moduleInvokeSurface } from "../../moduleAssetHelpers";

const harmonyEmitterModuleAsset = createBuiltinModuleAsset({
    id: "harmony.emitter",
    description: "Built-in Harmony event emitter bridges.",
    semanticsFamily: "harmony-event-emitter",
    role: "handoff",
    capability: "module.event-emitter",
    surfaces: [
        moduleInvokeSurface("harmony.emitter.EventEmitter.on", "EventEmitter", "on", 2, "instance", "@ohos.events.emitter"),
        moduleInvokeSurface("harmony.emitter.EventEmitter.emit", "EventEmitter", "emit", 2, "instance", "@ohos.events.emitter"),
        moduleInvokeSurface("harmony.emitter.emitter.on", "emitter", "on", 2, "namespace", "@ohos.events.emitter"),
        moduleInvokeSurface("harmony.emitter.emitter.emit", "emitter", "emit", 2, "namespace", "@ohos.events.emitter"),
    ],
    payload: {
        onMethods: ["on"],
        emitMethods: ["emit"],
        maxCandidates: 8,
    },
});

export default harmonyEmitterModuleAsset;
