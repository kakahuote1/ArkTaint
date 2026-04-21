import { taint } from "./taint_mock";

export function promise_executor_control_008_F(taint_src: string): void {
    void new Promise<void>(resolve => {
        void taint_src;
        taint.Sink("safe");
        resolve();
    });
}
