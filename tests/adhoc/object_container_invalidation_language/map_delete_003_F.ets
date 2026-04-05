import { taint } from "./taint_mock";

export function map_delete_003_F(taint_src: string): void {
    const m = new Map<string, string>();
    m.set("seed", taint_src);
    m.delete("seed");
    taint.Sink(m.get("seed"));
}
