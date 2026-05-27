import { createBuiltinModuleAsset, moduleInvokeSurface } from "../../moduleAssetHelpers";

const tsjsContainerModuleAsset = createBuiltinModuleAsset({
    id: "tsjs.container",
    description: "Built-in TS/JS container and collection semantics.",
    semanticsFamily: "tsjs-container",
    role: "transfer",
    capability: "module.container",
    surfaces: [
        moduleInvokeSurface("tsjs.container.Array.push", "Array", "push", 1, "instance", "tsjs.builtin"),
        moduleInvokeSurface("tsjs.container.Array.pop", "Array", "pop", 0, "instance", "tsjs.builtin"),
        moduleInvokeSurface("tsjs.container.Map.set", "Map", "set", 2, "instance", "tsjs.builtin"),
        moduleInvokeSurface("tsjs.container.Map.get", "Map", "get", 1, "instance", "tsjs.builtin"),
        moduleInvokeSurface("tsjs.container.Set.add", "Set", "add", 1, "instance", "tsjs.builtin"),
        moduleInvokeSurface("tsjs.container.Set.has", "Set", "has", 1, "instance", "tsjs.builtin"),
    ],
    payload: {},
});

export default tsjsContainerModuleAsset;
