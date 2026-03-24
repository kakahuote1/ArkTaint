import { TaskPool, taint } from "./taint_mock";

function taskJob(value: string): void {
    taint.Sink(value);
}

class WorkerPage002 {
    build(): void {
        new TaskPool().execute(taskJob, "scheduled");
    }
}

export function worker_taskpool_build_002_T(): void {
    void WorkerPage002;
}
