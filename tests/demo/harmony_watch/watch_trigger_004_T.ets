import { Watch, taint } from "./taint_mock";

class WatchComp004 {
    data: string = "";

    assign(v: string): void {
        this.data = v;
    }

    @Watch("data")
    onDataChanged(): void {
        taint.Sink(this.data);
    }
}

export function watch_trigger_004_T(taint_src: string): void {
    const c = new WatchComp004();
    c.assign(taint_src);
}
