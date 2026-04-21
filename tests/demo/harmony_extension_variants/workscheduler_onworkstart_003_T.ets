import { WorkSchedulerExtensionAbility, taint } from "./taint_mock";

class ProbeWorkSchedulerExtension extends WorkSchedulerExtensionAbility {
    onWorkStart(workInfo: any): void {
        taint.Sink(workInfo);
    }
}

export function workscheduler_onworkstart_003_T(): void {
    void ProbeWorkSchedulerExtension;
}

