import { Component, State, Watch, taint } from "./taint_mock";

@Component()
class ReactiveWatchCapture001 {
    @State
    token: string = "";

    update(v: string): void {
        this.token = v;
    }

    @Watch("token")
    onTokenChanged(): void {
        taint.Sink(this.token);
    }
}

export function reactive_watch_capture_001_T(taint_src: string): void {
    const page = new ReactiveWatchCapture001();
    page.update(taint_src);
}
