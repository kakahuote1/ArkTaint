import { taint } from "./taint_mock";

export async function promise_catch_await_payload_004_F(taint_src: string): Promise<void> {
    const out = await Promise.reject(taint_src).catch(_reason => "safe");
    taint.Sink(out);
}
