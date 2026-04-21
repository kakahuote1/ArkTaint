// Optimization 2: Nested Closure Recursion — Two-level capture relay
// Verifies: taint_src captured by outer closure, then the inner closure
// captures the relayed value. Transitive CAPTURE_FWD edges are built
// across both levels: caller → outer → inner → Sink.
import { taint } from "./taint_mock";

export function b3_nested_closure_001_T(taint_src: string): void {
    const outer = (): void => {
        const relay = taint_src;
        const inner = (): void => {
            taint.Sink(relay);
        };
        inner();
    };
    outer();
}
