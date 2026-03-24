import { AbilityStage, SharedStageStore, taint } from "./taint_mock";

class EntryAbilityStage001 extends AbilityStage {
    onCreate(): void {
        SharedStageStore.token = taint.Source();
    }
}

class FeatureAbilityStage001 extends AbilityStage {
    onCreate(): void {
        taint.Sink(SharedStageStore.token);
    }
}

export function abilitystage_crosshap_chain_001_T(): void {
    void EntryAbilityStage001;
    void FeatureAbilityStage001;
}
