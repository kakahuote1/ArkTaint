import { taint } from "./taint_mock";

/**
 * 返回值传递：只有 clean 通过 f 返回，不应触发
 */
export function return_value_passing_002_F(taint_src: string) {
    let _t = taint_src;
    let _clean = "clean";
    let t = f(_clean);
    taint.Sink(t);
}
function f(t: string) {
    return t;
}
