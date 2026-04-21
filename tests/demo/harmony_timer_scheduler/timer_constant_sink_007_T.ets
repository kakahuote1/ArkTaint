import { taint } from "./taint_mock";

class TimerPage007 {
    build(): void {
        const taint_src = "unused-secret";
        setTimeout(() => {
            void taint_src;
            taint.Sink("safe");
        }, 0);
    }
}

export function timer_constant_sink_007_T(): void {
    void TimerPage007;
}

