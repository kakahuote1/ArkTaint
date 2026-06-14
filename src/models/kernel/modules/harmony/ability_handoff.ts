import { createBuiltinModuleAsset, moduleInvokeSurface } from "../../moduleAssetHelpers";

const startMethods = [
    "startAbility",
    "startAbilityForResult",
    "connectServiceExtensionAbility",
    "startServiceExtensionAbility",
    "startAbilityByCall",
    "openLink",
    "terminateSelfWithResult",
];
const targetMethods = [
    "onCreate",
    "onNewWant",
    "onConnect",
    "onRequest",
    "onAbilityResult",
    "onResult",
];
const startMethodArgCounts = new Map<string, number>([
    ["connectServiceExtensionAbility", 3],
    ["openLink", 2],
]);
const targetMethodArgCounts = new Map<string, number>([
    ["onConnect", 1],
    ["onAbilityResult", 3],
    ["onResult", 1],
    ["onRequest", 1],
]);

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
            startMethodArgCounts.get(method) || 1,
            "instance",
            "@ohos.app.ability.common",
        )),
        ...targetMethods.map(method => moduleInvokeSurface(
            `harmony.ability_handoff.Ability.${method}`,
            "Ability",
            method,
            targetMethodArgCounts.get(method) || 2,
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
