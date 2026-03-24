export function Component(_target: Function): void {
    void _target;
}

export function scheduleTimeout(callback: () => void): void {
    setTimeout(callback, 0);
}

export function scheduleMicrotask(callback: () => void): void {
    queueMicrotask(callback);
}

export function makeTimeoutHandler(): () => void {
    return function onFactoryTimeoutCb(): void {};
}
