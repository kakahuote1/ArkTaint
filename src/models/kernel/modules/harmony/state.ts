import { createBuiltinModuleAsset } from "../../moduleAssetHelpers";
import { officialDecoratorSurfaceFromId } from "../../moduleAssetHelpers";

const stateDecoratorCanonicalApiIds = [
    "api:official:arkui:module=api%2Farkui%2FstateManagement%2Fcommon.d.ets:file=api%2Farkui%2FstateManagement%2Fcommon.d.ets:export=named%3AState:decl=interface%3AState:member=decorator%3AState:invoke=decorator:params=none:ret=void",
];

const propDecoratorCanonicalApiIds = [
    "api:official:arkui:module=api%2Farkui%2FstateManagement%2Fcommon.d.ets:file=api%2Farkui%2FstateManagement%2Fcommon.d.ets:export=named%3AProp:decl=interface%3AProp:member=decorator%3AProp:invoke=decorator:params=none:ret=void",
];

const linkDecoratorCanonicalApiIds = [
    "api:official:arkui:module=api%2Farkui%2FstateManagement%2Fcommon.d.ets:file=api%2Farkui%2FstateManagement%2Fcommon.d.ets:export=named%3ALink:decl=interface%3ALink:member=decorator%3ALink:invoke=decorator:params=none:ret=void",
    "api:official:arkui:module=api%2Farkui%2FstateManagement%2Fcommon.d.ets:file=api%2Farkui%2FstateManagement%2Fcommon.d.ets:export=named%3AObjectLink:decl=interface%3AObjectLink:member=decorator%3AObjectLink:invoke=decorator:params=none:ret=void",
];

const provideDecoratorCanonicalApiIds = [
    "api:official:arkui:module=api%2Farkui%2FstateManagement%2Fcommon.d.ets:file=api%2Farkui%2FstateManagement%2Fcommon.d.ets:export=named%3AProvide:decl=interface%3AProvide:member=decorator%3AProvide:invoke=decorator:params=none:ret=void",
];

const consumeDecoratorCanonicalApiIds = [
    "api:official:arkui:module=api%2Farkui%2FstateManagement%2Fcommon.d.ets:file=api%2Farkui%2FstateManagement%2Fcommon.d.ets:export=named%3AConsume:decl=interface%3AConsume:member=decorator%3AConsume:invoke=decorator:params=none:ret=void",
];

const allDecoratorCanonicalApiIds = [
    ...stateDecoratorCanonicalApiIds,
    ...propDecoratorCanonicalApiIds,
    ...linkDecoratorCanonicalApiIds,
    ...provideDecoratorCanonicalApiIds,
    ...consumeDecoratorCanonicalApiIds,
];

const harmonyStateModuleAsset = createBuiltinModuleAsset({
    id: "harmony.state",
    description: "Built-in Harmony state/prop/link/provide-consume bridges.",
    semanticsFamily: "harmony-state-binding",
    role: "handoff",
    capability: "module.state-binding",
    surfaces: allDecoratorCanonicalApiIds.map(officialDecoratorSurfaceFromId),
    payload: {
        stateDecoratorCanonicalApiIds,
        propDecoratorCanonicalApiIds,
        linkDecoratorCanonicalApiIds,
        provideDecoratorCanonicalApiIds,
        consumeDecoratorCanonicalApiIds,
    },
});

export default harmonyStateModuleAsset;
