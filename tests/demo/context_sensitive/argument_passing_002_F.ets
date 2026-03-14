import { taint } from "./taint_mock";

/**
 * 参数传递：只有 clean 传入 f，不应触发
 */
export function argument_passing_002_F(taint_src: string) {
    let _t = taint_src;
    let _clean = "clean";
    f(_clean);
}
function f(t: string) {
    taint.Sink(t);
}
