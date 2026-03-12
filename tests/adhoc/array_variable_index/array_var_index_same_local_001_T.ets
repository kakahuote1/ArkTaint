import { taint } from "./taint_mock";

export function array_var_index_same_local_001_T(taint_src: string): void {
    const arr = ["a", "b", "c"];
    const i = 0;
    arr[i] = taint_src;
    taint.Sink(arr[i]);
}
