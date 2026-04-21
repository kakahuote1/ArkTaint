import { Watch, taint } from "./taint_mock";

class WatchComp006 {
    token: string = "";

    @Watch("token")
    onTokenChanged(): void {
        taint.Sink("safe");
    }
}

export function watch_explicit_safe_sink_006_F(taint_src: string): void {
    const _u = taint_src;
    const c = new WatchComp006();
    c.token = "const";
}
