import { Emitter, taint } from "./taint_mock";

export function emitter_emit_alias_002_T(taint_src: string): void {
    const e = new Emitter();
    e.on("evt", (data: string): void => {
        const copy = data;
        taint.Sink(copy);
    });
    e.emit("evt", taint_src);
}
