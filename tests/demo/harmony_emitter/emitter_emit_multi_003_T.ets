import { Emitter, taint } from "./taint_mock";

export function emitter_emit_multi_003_T(taint_src: string): void {
    const e = new Emitter();
    e.on("a", (v: string): void => { taint.Sink(v); });
    e.on("b", (_v: string): void => { taint.Sink("safe"); });
    e.emit("a", taint_src);
}
