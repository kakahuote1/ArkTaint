import { taint } from "./taint_mock";
import { shadowSeed, writeShadowSeed } from "./binding_shadow_shared";

function shadow(shadowSeed: string): void {
    taint.Sink(shadowSeed);
}

export function module_import_binding_shadow_019_F(taint_src: string): void {
    writeShadowSeed(taint_src);
    shadow("_");
}
