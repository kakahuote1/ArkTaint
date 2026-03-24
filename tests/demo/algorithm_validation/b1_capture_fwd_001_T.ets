// Algorithm B - CAPTURE_FWD: Single-layer forward capture
// Verifies: Outer variable `taint_src` is captured by the closure.
// ArkAnalyzer represents this as %AC field. E_fwd edge propagates
// taint from caller's `taint_src` to the closure's internal read.
import { taint } from "./taint_mock";

export function b1_capture_fwd_001_T(taint_src: string): void {
    const closure = (): void => {
        taint.Sink(taint_src);
    };
    closure();
}
