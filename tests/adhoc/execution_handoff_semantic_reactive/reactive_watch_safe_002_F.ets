import { Component, State, Watch, taint } from "./taint_mock";

@Component()
class ReactiveWatchSafe002 {
    @State
    token: string = "";

    update(v: string): void {
        this.token = v;
    }

    @Watch("token")
    onTokenChanged(): void {
        const stable = this.token;
        void stable;
        taint.Sink("safe");
    }
}

export function reactive_watch_safe_002_F(taint_src: string): void {
    const page = new ReactiveWatchSafe002();
    page.update(taint_src);
}
