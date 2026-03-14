import { Worker, taint } from "./taint_mock";

export function worker_postmessage_001_T(taint_src: string): void {
    const w = new Worker();
    w.onMessage((msg: string): void => {
        taint.Sink(msg);
    });
    w.postMessage(taint_src);
}
