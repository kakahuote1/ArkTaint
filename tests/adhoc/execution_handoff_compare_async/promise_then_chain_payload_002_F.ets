import { taint } from "./taint_mock";

export function promise_then_chain_payload_002_F(taint_src: string): void {
    Promise.resolve(taint_src)
        .then(_value => "safe")
        .then(value => {
            taint.Sink(value);
        });
}
