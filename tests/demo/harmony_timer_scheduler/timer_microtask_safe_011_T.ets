import { scheduleMicrotask, taint } from "./taint_mock";

class TimerPage011 {
    build(): void {
        scheduleMicrotask(() => {
            taint.Sink("clean");
        });
    }
}

export function timer_microtask_safe_011_T(): void {
    new TimerPage011().build();
}
