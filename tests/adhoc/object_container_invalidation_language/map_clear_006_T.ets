import { taint } from "./taint_mock";

export function map_clear_006_T(taint_src: string): void {
    const m = new Map<string, string>();
    m.set("seed", "safe");
    m.clear();
    m.set("seed", taint_src);
    taint.Sink(m.get("seed"));
}
