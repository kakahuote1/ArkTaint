import { WorkSchedulerExtensionAbility, taint } from "./taint_mock";

class ProbeWorkSchedulerExtension extends WorkSchedulerExtensionAbility {
    onWorkStop(_workInfo: any): void {
        taint.Sink("safe");
    }
}

export function workscheduler_onworkstop_004_T(): void {
    void ProbeWorkSchedulerExtension;
}

