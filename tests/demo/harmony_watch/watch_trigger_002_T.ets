import { Watch, taint } from "./taint_mock";

class WatchComp002 {
    value: string = "";

    setValue(v: string): void {
        this.value = v;
    }

    @Watch("value")
    onValueChanged(): void {
        const copy = this.value;
        taint.Sink(copy);
    }
}

export function watch_trigger_002_T(taint_src: string): void {
    const c = new WatchComp002();
    c.setValue(taint_src);
}
