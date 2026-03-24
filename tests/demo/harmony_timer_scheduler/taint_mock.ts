export namespace taint {
    export function Source(): string {
        return "timer-taint";
    }
    export function Sink(value: any): void {
        void value;
    }
}

export function scheduleTimeout(callback: () => void): void {
    setTimeout(callback, 0);
}

export function scheduleMicrotask(callback: () => void): void {
    queueMicrotask(callback);
}

export function makeTimeoutHandler(): () => void {
    const taint_src = taint.Source();
    return () => {
        taint.Sink(taint_src);
    };
}
