// Optimization 2: Nested Closure Recursion — Nested but clean path
// Verifies: Nested structure exists, but inner closure only uses a
// locally defined clean value. No transitive taint should propagate.
import { taint } from "./taint_mock";

export function b3_nested_closure_002_F(taint_src: string): void {
    const _unused = taint_src;
    const outer = (): void => {
        const cleanVal = "no_taint";
        const inner = (): void => {
            taint.Sink(cleanVal);
        };
        inner();
    };
    outer();
}
