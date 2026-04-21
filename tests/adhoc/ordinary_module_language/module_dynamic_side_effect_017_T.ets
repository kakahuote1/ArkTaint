import { taint } from "./taint_mock";
import { writeSideEffectSeed } from "./side_effect_seed";

export async function module_dynamic_side_effect_017_T(taint_src: string): Promise<void> {
    writeSideEffectSeed(taint_src);
    const snapshot = await import("./side_effect_snapshot");
    taint.Sink(snapshot.mirroredSnapshot);
}
