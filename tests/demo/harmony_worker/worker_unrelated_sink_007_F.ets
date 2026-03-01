import { Worker, taint } from "./taint_mock";

export function worker_unrelated_sink_007_F(taint_src: string): void {
    const _u = taint_src;
    const w = new Worker();
    w.onMessage((_m: string): void => {
        taint.Sink("const");
    });
}
