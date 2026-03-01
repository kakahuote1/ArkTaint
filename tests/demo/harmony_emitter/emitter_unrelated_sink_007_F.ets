import { Emitter, taint } from "./taint_mock";

export function emitter_unrelated_sink_007_F(taint_src: string): void {
    const _u = taint_src;
    const e = new Emitter();
    e.on("x", (_v: string): void => { taint.Sink("const"); });
}
