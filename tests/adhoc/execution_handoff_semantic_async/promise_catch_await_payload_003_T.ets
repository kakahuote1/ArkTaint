import { taint } from "./taint_mock";

export async function promise_catch_await_payload_003_T(taint_src: string): Promise<void> {
    const out = await Promise.reject(taint_src).catch(reason => reason);
    taint.Sink(out);
}
