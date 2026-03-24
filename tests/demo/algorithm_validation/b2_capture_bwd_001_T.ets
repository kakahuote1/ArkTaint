// Optimization 3: CAPTURE_BWD — Closure writes taint back to outer variable
// Verifies: The closure captures mutable variable `result` and writes
// taint_src into it. E_bwd edge propagates taint from closure's write
// back to the caller's `result`, which then flows to Sink.
import { taint } from "./taint_mock";

export function b2_capture_bwd_001_T(taint_src: string): void {
    let result = "";
    const mutator = (): void => {
        result = taint_src;
    };
    mutator();
    taint.Sink(result);
}
