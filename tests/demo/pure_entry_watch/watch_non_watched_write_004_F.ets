import { Watch, taint } from "./taint_mock";

class WatchPage004 {
    token: string = "";
    other: string = "";

    build(): void {
        this.other = "not-token";
    }

    @Watch("token")
    onTokenChanged(): void {
        taint.Sink(this.token);
    }
}

export function watch_non_watched_write_004_F(): void {
    void WatchPage004;
}
