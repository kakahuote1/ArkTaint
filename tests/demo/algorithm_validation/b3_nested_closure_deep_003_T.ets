// Optimization 2: Nested Closure Recursion — Three-level deep capture
// Verifies: Three levels of closure nesting. Transitive capture edge
// chain: caller → level1 → level2 → level3 → Sink.
// This stress-tests the recursive capture propagation depth.
import { taint } from "./taint_mock";

export function b3_nested_closure_deep_003_T(taint_src: string): void {
    const level1 = (): void => {
        const hop1 = taint_src;
        const level2 = (): void => {
            const hop2 = hop1;
            const level3 = (): void => {
                taint.Sink(hop2);
            };
            level3();
        };
        level2();
    };
    level1();
}
