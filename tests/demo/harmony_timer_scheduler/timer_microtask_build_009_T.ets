import { scheduleMicrotask, taint } from "./taint_mock";

class TimerPage009 {
    build(taint_src: string): void {
        scheduleMicrotask(() => {
            taint.Sink(taint_src);
        });
    }
}

export function timer_microtask_build_009_T(taint_src: string): void {
    new TimerPage009().build(taint_src);
}
