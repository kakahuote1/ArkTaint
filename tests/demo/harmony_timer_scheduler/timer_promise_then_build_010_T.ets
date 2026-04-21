import { taint } from "./taint_mock";

class TimerPage010 {
    build(taint_src: string): void {
        Promise.resolve().then(() => {
            taint.Sink(taint_src);
        });
    }
}

export function timer_promise_then_build_010_T(taint_src: string): void {
    new TimerPage010().build(taint_src);
}
