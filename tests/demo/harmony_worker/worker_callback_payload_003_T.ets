import { Worker, taint } from "./taint_mock";

export function worker_callback_payload_003_T(taint_src: string): void {
    const worker = new Worker();
    worker.onMessage((payload: string): void => {
        const mirror = payload;
        taint.Sink(mirror);
    });
    worker.postMessage(taint_src);
}
