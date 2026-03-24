// Optimization 5: PAG On-Demand Materialization
// Verifies: Multiple callback registrations exist but only the tainted
// path should trigger edge materialization via the lazy mechanism.
// If lazy materialization breaks, edges won't be created and taint
// won't flow to the sink.
import { taint } from "./taint_mock";

function schedule(name: string, action: () => void): void {
    action();
}

export function b6_lazy_materialization_001_T(taint_src: string): void {
    schedule("task_a", () => {
        console.log("clean");
    });
    schedule("task_b", () => {
        taint.Sink(taint_src);
    });
    schedule("task_c", () => {
        console.log("also clean");
    });
}
