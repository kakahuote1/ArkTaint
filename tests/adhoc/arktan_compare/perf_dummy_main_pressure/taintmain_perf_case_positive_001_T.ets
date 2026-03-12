import { taint } from "./taint_mock";

export function taintmain_perf_case_positive_001_T(taint_src: string): void {
    const arr = new Array<string>(1);
    arr[0] = taint_src;
    const out = arr[0];
    taint.Sink(out);
}
