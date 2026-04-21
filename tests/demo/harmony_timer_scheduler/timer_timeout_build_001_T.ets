import { taint } from "./taint_mock";

class TimerPage001 {
    build(): void {
        const taint_src = taint.Source();
        setTimeout(() => {
            taint.Sink(taint_src);
        }, 0);
    }
}

export function timer_timeout_build_001_T(): void {
    void TimerPage001;
}
