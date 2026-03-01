import { Emitter, taint } from "./taint_mock";

export function emitter_emit_on_001_T(taint_src: string): void {
    const e = new Emitter();
    e.on("login", (data: string): void => {
        taint.Sink(data);
    });
    e.emit("login", taint_src);
}
