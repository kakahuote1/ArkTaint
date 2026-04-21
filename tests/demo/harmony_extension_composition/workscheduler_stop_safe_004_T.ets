import { WorkSchedulerExtensionAbility, taint } from "./taint_mock";

class ProbeWorkScheduler004 extends WorkSchedulerExtensionAbility {
    onWorkStop(_workInfo: any): void {
        taint.Sink("clean");
    }
}

export function workscheduler_stop_safe_004_T(): void {
    void ProbeWorkScheduler004;
}
