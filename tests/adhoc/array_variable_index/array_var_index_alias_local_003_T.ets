import { taint } from "./taint_mock";

export function array_var_index_alias_local_003_T(taint_src: string): void {
    const arr = ["a", "b", "c"];
    const i = 0;
    const j = i;
    arr[i] = taint_src;
    taint.Sink(arr[j]);
}
