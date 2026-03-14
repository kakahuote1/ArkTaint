import { taskpool, taint } from "./taint_mock";

function safeJob(_v: string): void {
    taint.Sink("safe");
}

export function worker_sink_constant_006_F(taint_src: string): void {
    const _u = taint_src;
    taskpool.execute(safeJob, "safe");
}
