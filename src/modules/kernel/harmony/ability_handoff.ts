import type { ModuleSpec } from "../../../core/kernel/contracts/ModuleSpec";

const harmonyAbilityHandoffModuleSpec: ModuleSpec = {
    id: "harmony.ability_handoff",
    semantics: [
        {
            kind: "ability_handoff",
            startMethods: [
                "startAbility",
                "startAbilityForResult",
                "connectServiceExtensionAbility",
            ],
            targetMethods: [
                "onCreate",
                "onNewWant",
                "onConnect",
            ],
        },
    ],
};

export default harmonyAbilityHandoffModuleSpec;
