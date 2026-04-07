import { Component, State, Monitor, taint } from "./taint_mock";

@Component()
class ReactiveMonitorCapture003 {
    @State
    token: string = "";

    write(v: string): void {
        this.token = v;
    }

    @Monitor("token")
    onTokenMonitorChanged(): void {
        taint.Sink(this.token);
    }
}

export function reactive_monitor_capture_003_T(taint_src: string): void {
    const page = new ReactiveMonitorCapture003();
    page.write(taint_src);
}
