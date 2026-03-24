import { Monitor, taint } from "./taint_mock";

class WatchPage005 {
    token: string = "";

    build(): void {
        this.token = "changed";
    }

    @Monitor("token")
    onTokenMonitorChanged(): void {
        taint.Sink(this.token);
    }
}

export function watch_monitor_trigger_005_T(): void {
    void WatchPage005;
}
