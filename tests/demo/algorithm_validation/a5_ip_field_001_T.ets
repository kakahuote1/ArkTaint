// Optimization 1: IP_field — store-then-invoke via sibling method
// Verifies: `register(cb)` stores cb to this._handler,
// sibling method `trigger()` invokes this._handler().
// IP_field detects this relay and builds CALL edge.
import { taint } from "./taint_mock";

class Dispatcher {
    private _handler: (() => void) | null = null;

    register(cb: () => void): void {
        this._handler = cb;
    }

    trigger(): void {
        if (this._handler) {
            this._handler();
        }
    }
}

export function a5_ip_field_001_T(taint_src: string): void {
    const d = new Dispatcher();
    d.register(() => {
        taint.Sink(taint_src);
    });
    d.trigger();
}
