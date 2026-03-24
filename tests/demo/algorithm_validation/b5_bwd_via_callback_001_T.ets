// Combined: CAPTURE_BWD + Callback invocation
// Verifies: Closure captures mutable `out` and writes taint_src to it.
// The closure is passed as callback to `run(cb)` which invokes it.
// Algorithm A builds CALL edge for run→cb, Algorithm B builds
// CAPTURE_BWD edge for the write-back. Both needed for taint to Sink.
import { taint } from "./taint_mock";

function run(cb: () => void): void {
    cb();
}

export function b5_bwd_via_callback_001_T(taint_src: string): void {
    let out = "";
    const writer = (): void => {
        out = taint_src;
    };
    run(writer);
    taint.Sink(out);
}
