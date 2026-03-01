import { Watch, taint } from "./taint_mock";

class WatchComp007 {
    token: string = "";

    @Watch("token")
    onTokenChanged(): void {
        taint.Sink(this.token);
    }
}

export function watch_non_watched_path_007_F(taint_src: string): void {
    const _u = taint_src;
    const c = new WatchComp007();
    c.token = "safe";
    taint.Sink("safe");
}
