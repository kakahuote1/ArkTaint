class TimerPage008 {
    build(): void {
        const taint_src = "unused-secret";
        setInterval(() => {
            void taint_src;
        }, 0);
    }
}

export function timer_interval_no_sink_008_T(): void {
    void TimerPage008;
}

