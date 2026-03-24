import { WorkSchedulerExtensionAbility, taint } from "./taint_mock";

class ProbeWorkScheduler003 extends WorkSchedulerExtensionAbility {
    private token: string = "";

    onWorkStart(_workInfo: any): void {
        this.token = taint.Source();
        this.flush();
    }

    private flush(): void {
        taint.Sink(this.token);
    }
}

export function workscheduler_helper_003_T(): void {
    void ProbeWorkScheduler003;
}
