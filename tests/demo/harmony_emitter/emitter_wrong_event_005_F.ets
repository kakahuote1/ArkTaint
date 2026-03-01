import { Emitter, taint } from "./taint_mock";

export function emitter_wrong_event_005_F(taint_src: string): void {
    const e = new Emitter();
    e.on("A", (v: string): void => { taint.Sink(v); });
    e.emit("B", taint_src);
}
