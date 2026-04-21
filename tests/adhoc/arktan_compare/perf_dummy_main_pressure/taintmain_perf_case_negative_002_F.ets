import { taint } from "./taint_mock";

export function taintmain_perf_case_negative_002_F(clean_src: string): void {
    const arr = new Array<string>(1);
    if (clean_src === "__never__") {
        arr[0] = clean_src;
    }
    arr[0] = "safe";
    const out = arr[0];
    taint.Sink(out);
}
