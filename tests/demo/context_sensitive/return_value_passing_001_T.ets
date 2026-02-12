import { taint } from "./taint_mock";

/**
 * 返回值传递：taint_src 通过 f 返回
 */
export function return_value_passing_001_T(taint_src: string) {
    let t = f(taint_src);
    taint.Sink(t);
}
function f(t: string) {
    return t;
}
