import { Component, State, Monitor, taint } from "./taint_mock";

@Component()
class ReactiveMonitorSafe004 {
    @State
    token: string = "";

    write(v: string): void {
        this.token = v;
    }

    @Monitor("token")
    onTokenMonitorChanged(): void {
        const stable = this.token;
        void stable;
        taint.Sink("safe");
    }
}

export function reactive_monitor_safe_004_F(taint_src: string): void {
    const page = new ReactiveMonitorSafe004();
    page.write(taint_src);
}
