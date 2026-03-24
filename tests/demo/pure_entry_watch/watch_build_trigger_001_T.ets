import { Watch, taint } from "./taint_mock";

class WatchPage001 {
    token: string = "";

    build(): void {
        this.update("changed");
    }

    update(value: string): void {
        this.token = value;
    }

    @Watch("token")
    onTokenChanged(): void {
        taint.Sink(this.token);
    }
}

export function watch_build_trigger_001_T(): void {
    void WatchPage001;
}
