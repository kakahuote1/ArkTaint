import { taint, SystemEnv } from "./taint_mock";

class DemoAbilityStage016 {
    onStart(): void {
        const ctx = SystemEnv.getContext();
        taint.Sink(ctx);
    }
}

export function lifecycle_abilitystage_non_oncreate_016_F(): void {
    const stage = new DemoAbilityStage016();
    stage.onStart();
}

