import { Emitter, taint } from "./taint_mock";

function sendToSink(v: string): void {
    taint.Sink(v);
}

export function emitter_emit_nested_004_T(taint_src: string): void {
    const e = new Emitter();
    e.on("track", (v: string): void => {
        sendToSink(v);
    });
    e.emit("track", taint_src);
}
