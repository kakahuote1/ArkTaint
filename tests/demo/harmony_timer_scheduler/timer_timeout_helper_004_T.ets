import { scheduleTimeout, taint } from "./taint_mock";

class TimerPage004 {
    build(): void {
        const taint_src = taint.Source();
        scheduleTimeout(() => {
            taint.Sink(taint_src);
        });
    }
}

export function timer_timeout_helper_004_T(): void {
    void TimerPage004;
}
