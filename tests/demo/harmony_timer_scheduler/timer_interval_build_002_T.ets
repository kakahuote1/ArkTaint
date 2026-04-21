import { taint } from "./taint_mock";

class TimerPage002 {
    build(): void {
        const taint_src = taint.Source();
        setInterval(() => {
            taint.Sink(taint_src);
        }, 0);
    }
}

export function timer_interval_build_002_T(): void {
    void TimerPage002;
}
