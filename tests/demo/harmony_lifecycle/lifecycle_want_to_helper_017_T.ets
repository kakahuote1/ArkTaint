import { Want, taint } from "./taint_mock";

function emitToSink(v: string): void {
    taint.Sink(v);
}

class Ability017 {
    onCreate(want: Want): void {
        const token = want.parameters;
        emitToSink(token);
    }
}

export function lifecycle_want_to_helper_017_T(): void {
    const a = new Ability017();
    const w = new Want();
    w.parameters = "tainted";
    a.onCreate(w);
}

