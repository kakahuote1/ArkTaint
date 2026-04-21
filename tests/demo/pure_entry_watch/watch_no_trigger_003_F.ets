import { Watch, taint } from "./taint_mock";

class WatchPage003 {
    token: string = "";

    build(): void {
        return;
    }

    @Watch("token")
    onTokenChanged(): void {
        taint.Sink(this.token);
    }
}

export function watch_no_trigger_003_F(): void {
    void WatchPage003;
}
