import { taint } from "./taint_mock";

class TimerPage003 {
    build(): void {
        const taint_src = taint.Source();
        requestAnimationFrame((_ts) => {
            taint.Sink(taint_src);
        });
    }
}

export function timer_raf_build_003_T(): void {
    void TimerPage003;
}
