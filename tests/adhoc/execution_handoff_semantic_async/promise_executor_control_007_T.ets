import { taint } from "./taint_mock";

export function promise_executor_control_007_T(taint_src: string): void {
    void new Promise<void>(resolve => {
        taint.Sink(taint_src);
        resolve();
    });
}
