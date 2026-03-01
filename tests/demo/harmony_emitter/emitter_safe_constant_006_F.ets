import { Emitter, taint } from "./taint_mock";

export function emitter_safe_constant_006_F(): void {
    const e = new Emitter();
    e.on("safe", (_v: string): void => { taint.Sink("safe"); });
    e.emit("safe", "safe");
}
