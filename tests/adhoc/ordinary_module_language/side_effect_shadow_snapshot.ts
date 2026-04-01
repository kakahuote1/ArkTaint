import { sideEffectSeed } from "./side_effect_seed";

export let mirroredShadowSnapshot: string = "_";

function overwrite(sideEffectSeed: string): void {
    mirroredShadowSnapshot = sideEffectSeed;
}

overwrite("_");
