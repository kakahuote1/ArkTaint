import { taint } from "./taint_mock";

export function map_clear_005_F(taint_src: string): void {
    const m = new Map<string, string>();
    m.set("seed", taint_src);
    m.clear();
    taint.Sink(m.get("seed"));
}
