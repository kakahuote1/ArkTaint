// Optimization 5: PAG On-Demand Materialization — No taint path
// Verifies: Multiple callbacks scheduled but none carry taint to Sink.
// Lazy materialization should still work correctly and report no flow.
import { taint } from "./taint_mock";

function schedule(name: string, action: () => void): void {
    action();
}

export function b6_lazy_materialization_002_F(taint_src: string): void {
    const _unused = taint_src;
    schedule("a", () => {
        taint.Sink("clean_a");
    });
    schedule("b", () => {
        taint.Sink("clean_b");
    });
}
