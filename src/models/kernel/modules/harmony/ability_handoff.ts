import { createBuiltinModuleAsset, moduleInvokeSurface } from "../../moduleAssetHelpers";

const startMethods = [
    "startAbility",
    "startAbilityForResult",
    "connectServiceExtensionAbility",
];
const targetMethods = [
    "onCreate",
    "onNewWant",
    "onConnect",
];

const harmonyAbilityHandoffModuleAsset = createBuiltinModuleAsset({
    id: "harmony.ability_handoff",
    description: "Built-in Harmony ability handoff semantics.",
    semanticsFamily: "harmony-ability-handoff",
    role: "handoff",
    capability: "module.ability-handoff",
    surfaces: [
        ...startMethods.map(method => moduleInvokeSurface(
            `harmony.ability_handoff.AbilityContext.${method}`,
            "AbilityContext",
            method,
            method === "connectServiceExtensionAbility" ? 3 : 1,
            "instance",
            "@ohos.app.ability.common",
        )),
        ...targetMethods.map(method => moduleInvokeSurface(
            `harmony.ability_handoff.Ability.${method}`,
            "Ability",
            method,
            method === "onConnect" ? 1 : 2,
            "instance",
            "@ohos.app.ability",
        )),
    ],
    payload: {
        startMethods,
        targetMethods,
    },
});

export default harmonyAbilityHandoffModuleAsset;
