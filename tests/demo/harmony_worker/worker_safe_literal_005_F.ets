import { Worker, taint } from "./taint_mock";

export function worker_safe_literal_005_F(): void {
    const w = new Worker();
    w.onMessage((_msg: string): void => {
        taint.Sink("safe");
    });
    w.postMessage("safe");
}
