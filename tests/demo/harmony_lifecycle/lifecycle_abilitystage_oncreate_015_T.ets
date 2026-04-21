import { AbilityStage, taint, SystemEnv } from "./taint_mock";

class DemoAbilityStage015 extends AbilityStage {
    onCreate(): void {
        const ctx = SystemEnv.getContext();
        taint.Sink(ctx);
    }
}

export function lifecycle_abilitystage_oncreate_015_T(): void {
    const stage = new DemoAbilityStage015();
    stage.onCreate();
}
