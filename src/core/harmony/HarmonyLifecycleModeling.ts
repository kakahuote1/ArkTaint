import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { Pag } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import {
    CALLBACK_METHOD_NAME,
    LIFECYCLE_METHOD_NAME,
} from "../../../arkanalyzer/out/src/utils/entryMethodUtils";
import { collectLifecycleParamSeeds, LifecycleParamSeedSpec } from "./LifecycleParamSeeder";
import {
    HarmonySeedCollectionArgs,
    HarmonySeedCollectionResult,
    mergeHarmonySeedCollectionResults,
} from "./HarmonySeedTypes";

export interface HarmonyLifecycleSeedCollectionArgs extends HarmonySeedCollectionArgs {
    scene: Scene;
    pag: Pag;
}

export type HarmonyLifecycleSeedCollectionResult = HarmonySeedCollectionResult;

const UI_ABILITY_WANT_SPEC: LifecycleParamSeedSpec = {
    sourceRuleId: "harmony.lifecycle.want_param",
    methodNames: ["onCreate", "onNewWant"],
    paramNameIncludes: ["want"],
    paramTypeIncludes: ["want"],
    matchMode: "name_and_type",
    targetFieldPaths: [["parameters"]],
    fallbackSeedRootWhenNoPointsTo: true,
    seedRootAlso: false,
};

const extensionMethodNames = new Set<string>([
    "onAddForm",
    "onUpdateForm",
    "onFormEvent",
    "onCastToNormalForm",
    "onRemoveForm",
    "onAcquireFormState",
]);
for (const name of LIFECYCLE_METHOD_NAME) {
    if (name.toLowerCase().includes("form")) {
        extensionMethodNames.add(name);
    }
}
for (const name of CALLBACK_METHOD_NAME) {
    if (name.toLowerCase().includes("form")) {
        extensionMethodNames.add(name);
    }
}

const EXTENSION_WANT_SPEC: LifecycleParamSeedSpec = {
    sourceRuleId: "harmony.extension.want_param",
    methodNames: [...extensionMethodNames],
    paramNameIncludes: ["want"],
    paramTypeIncludes: ["want"],
    matchMode: "name_and_type",
    targetFieldPaths: [["parameters"]],
    fallbackSeedRootWhenNoPointsTo: true,
    seedRootAlso: false,
};

const EXTENSION_FORM_BINDING_DATA_SPEC: LifecycleParamSeedSpec = {
    sourceRuleId: "harmony.extension.form_binding_data",
    methodNames: [...extensionMethodNames],
    paramNameIncludes: ["formbindingdata", "form_binding_data", "formdata"],
    matchMode: "name_only",
    targetFieldPaths: [["data"], ["value"], ["payload"], ["content"]],
    fallbackSeedRootWhenNoPointsTo: true,
    seedRootAlso: true,
};

export function collectHarmonyLifecycleSeeds(
    args: HarmonyLifecycleSeedCollectionArgs
): HarmonyLifecycleSeedCollectionResult {
    const uiAbilitySeeds = collectLifecycleParamSeeds({
        scene: args.scene,
        pag: args.pag,
        emptyContextId: args.emptyContextId,
        allowedMethodSignatures: args.allowedMethodSignatures,
        specs: [UI_ABILITY_WANT_SPEC],
    });

    const extensionSeeds = collectLifecycleParamSeeds({
        scene: args.scene,
        pag: args.pag,
        emptyContextId: args.emptyContextId,
        allowedMethodSignatures: args.allowedMethodSignatures,
        specs: [EXTENSION_WANT_SPEC, EXTENSION_FORM_BINDING_DATA_SPEC],
    });

    return mergeHarmonySeedCollectionResults([uiAbilitySeeds, extensionSeeds]);
}
