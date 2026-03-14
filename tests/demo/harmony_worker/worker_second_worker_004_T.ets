import { Worker, taint } from "./taint_mock";

export function worker_second_worker_004_T(taint_src: string): void {
    const w1 = new Worker();
    const w2 = new Worker();
    w2.onMessage((msg: string): void => {
        taint.Sink(msg);
    });
    w1.postMessage(taint_src);
}
