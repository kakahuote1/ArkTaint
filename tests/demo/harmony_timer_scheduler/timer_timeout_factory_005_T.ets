import { makeTimeoutHandler, scheduleTimeout } from "./taint_mock";

class TimerPage005 {
    build(): void {
        scheduleTimeout(makeTimeoutHandler());
    }
}

export function timer_timeout_factory_005_T(): void {
    void TimerPage005;
}

