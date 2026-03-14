import { Watch, taint } from "./taint_mock";

class WatchComp005 {
    token: string = "";

    @Watch("token")
    onTokenChanged(): void {
        taint.Sink(this.token);
    }
}

export function watch_no_trigger_005_F(): void {
    const c = new WatchComp005();
    c.token = "safe";
}
