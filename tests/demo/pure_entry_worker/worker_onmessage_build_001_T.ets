import { Worker, taint } from "./taint_mock";

class WorkerPage001 {
    build(): void {
        const worker = new Worker();
        worker.onMessage((payload: string): void => {
            taint.Sink(payload);
        });
    }
}

export function worker_onmessage_build_001_T(): void {
    void WorkerPage001;
}
