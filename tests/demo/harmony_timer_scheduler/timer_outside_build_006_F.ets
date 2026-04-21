import { taint } from "./taint_mock";

class TimerPage006 {
    schedule(): void {
        const taint_src = "outside-secret";
        setTimeout(() => {
            taint.Sink(taint_src);
        }, 0);
    }
}

export function timer_outside_build_006_F(): void {
    void TimerPage006;
}

