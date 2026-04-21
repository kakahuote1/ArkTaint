import { taint } from "./taint_mock";

export function map_delete_004_T(taint_src: string): void {
    const m = new Map<string, string>();
    m.set("seed", taint_src);
    m.delete("other");
    taint.Sink(m.get("seed"));
}
