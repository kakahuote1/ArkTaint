import { Component, makeTimeoutHandler, scheduleMicrotask, scheduleTimeout } from "./taint_mock";

function onTimeoutCb(): void {}
function onMicrotaskCb(): void {}
function onPromiseThenCb(): void {}

@Component
class SchedulerPage {
    build(): void {
        setTimeout(onTimeoutCb, 0);
        scheduleMicrotask(onMicrotaskCb);
        Promise.resolve().then(onPromiseThenCb);
        scheduleTimeout(makeTimeoutHandler());
    }
}

export function arkmain_scheduler_entry_001(): void {
    void SchedulerPage;
}
