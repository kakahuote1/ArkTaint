// Algorithm B - CAPTURE_FWD: Closure captures a clean variable, not tainted
// Verifies: Even though taint_src exists in the outer scope, the closure
// only captures `clean`. CAPTURE_FWD edge is for `clean` only → no taint.
import { taint } from "./taint_mock";

export function b1_capture_fwd_002_F(taint_src: string): void {
    const _unused = taint_src;
    const clean = "safe_value";
    const closure = (): void => {
        taint.Sink(clean);
    };
    closure();
}
