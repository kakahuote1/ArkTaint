import { taint } from "./taint_mock";

export function promise_then_chain_payload_001_T(taint_src: string): void {
    Promise.resolve(taint_src)
        .then(value => value)
        .then(value => {
            taint.Sink(value);
        });
}
