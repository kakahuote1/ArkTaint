import { Watch, taint } from "./taint_mock";

class WatchComp003 {
    payload: string = "";

    update(v: string): void {
        this.payload = v;
    }

    @Watch("payload")
    onPayloadChanged(): void {
        taint.Sink(this.payload);
    }
}

export function watch_trigger_003_T(taint_src: string): void {
    const c = new WatchComp003();
    c.update(taint_src);
}
