import { taint } from "./taint_mock";

export function array_var_index_diff_local_002_F(taint_src: string): void {
    const arr = ["a", "b", "c"];
    const i = 0;
    const j = 1;
    arr[i] = taint_src;
    taint.Sink(arr[j]);
}
