import { AbilityStage, SharedStageStore, taint } from "./taint_mock";

class EntryAbilityStage002 extends AbilityStage {
    onCreate(): void {
        SharedStageStore.token = "clean";
    }
}

class FeatureAbilityStage002 extends AbilityStage {
    onCreate(): void {
        taint.Sink(SharedStageStore.token);
    }
}

export function abilitystage_crosshap_safe_002_T(): void {
    void EntryAbilityStage002;
    void FeatureAbilityStage002;
}
