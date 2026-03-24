// Optimization 3: CAPTURE_BWD — Closure writes clean value back
// Verifies: The closure writes a clean literal "safe" to the captured
// variable. Even though `result` reaches Sink, the value written back
// is not tainted, so no taint flow should be detected.
import { taint } from "./taint_mock";

export function b2_capture_bwd_002_F(taint_src: string): void {
    const _unused = taint_src;
    let result = "";
    const mutator = (): void => {
        result = "safe";
    };
    mutator();
    taint.Sink(result);
}
