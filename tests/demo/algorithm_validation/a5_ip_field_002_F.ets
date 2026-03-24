// Optimization 1: IP_field — stored to field but never invoked by sibling
// Verifies: `stash(cb)` stores cb to this._handler, but NO sibling method
// ever invokes the field. IP_field returns empty → no CALL edge.
import { taint } from "./taint_mock";

class Stasher {
    private _handler: (() => void) | null = null;

    stash(cb: () => void): void {
        this._handler = cb;
    }

    describe(): string {
        return "I have a handler but never call it";
    }
}

export function a5_ip_field_002_F(taint_src: string): void {
    const s = new Stasher();
    s.stash(() => {
        taint.Sink(taint_src);
    });
    s.describe();
}
