import { taint } from "./taint_mock";

export async function promise_finally_capture_005_T(taint_src: string): Promise<void> {
    await Promise.resolve("safe").finally(() => {
        taint.Sink(taint_src);
    });
}
