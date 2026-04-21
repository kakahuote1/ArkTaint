import { taskpool, taint } from "./taint_mock";

function job(v: string): void {
    taint.Sink(v);
}

export function worker_taskpool_002_T(taint_src: string): void {
    taskpool.execute(job, taint_src);
}
