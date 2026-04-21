import { Watch, taint } from "./taint_mock";

class WatchComp001 {
    token: string = "";

    update(v: string): void {
        this.token = v;
    }

    @Watch("token")
    onTokenChanged(): void {
        taint.Sink(this.token);
    }
}

export function watch_trigger_001_T(taint_src: string): void {
    const c = new WatchComp001();
    c.update(taint_src);
}
