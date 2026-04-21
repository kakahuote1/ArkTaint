import { Watch, taint } from "./taint_mock";

class WatchPage002 {
    token: string = "";

    aboutToAppear(): void {
        this.token = "appear";
    }

    @Watch("token")
    onTokenChanged(): void {
        taint.Sink(this.token);
    }
}

export function watch_appear_trigger_002_T(): void {
    void WatchPage002;
}
