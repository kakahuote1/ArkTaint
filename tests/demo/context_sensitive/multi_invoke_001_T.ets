import { taint } from "./taint_mock";

/**
 * 多次调用同一函数，sink(a) 应该触发（a 来自 taint_src）
 */
export function multi_invoke_001_T(taint_src: string) {
    let a = f(taint_src);
    let b = f("_");
    taint.Sink(a);
}
function f(t: string) {
    return t;
}
