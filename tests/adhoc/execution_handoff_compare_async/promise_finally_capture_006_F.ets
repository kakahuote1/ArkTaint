import { taint } from "./taint_mock";

export async function promise_finally_capture_006_F(taint_src: string): Promise<void> {
    await Promise.resolve("safe").finally(() => {
        void taint_src;
        taint.Sink("safe");
    });
}
