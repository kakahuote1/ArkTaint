// Combined: Closure (capture edge) + Callback (synthetic invoke edge)
// Verifies: Algorithm A builds CALL edge for `execute(cb)`,
// Algorithm B builds CAPTURE_FWD edge for taint_src into the closure.
// Both algorithms must cooperate for taint to reach Sink.
import { taint } from "./taint_mock";

function execute(cb: () => void): void {
    cb();
}

export function b4_capture_plus_callback_001_T(taint_src: string): void {
    const handler = (): void => {
        taint.Sink(taint_src);
    };
    execute(handler);
}
