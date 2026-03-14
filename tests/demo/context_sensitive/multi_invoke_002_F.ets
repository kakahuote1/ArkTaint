import { taint } from "./taint_mock";

/**
 * 多次调用同一函数，sink(b) 不应触发（b 来自 clean 值）
 * 关键：需要上下文敏感来区分 f(taint_src) 和 f("_") 的返回值
 */
export function multi_invoke_002_F(taint_src: string) {
    let a = f(taint_src);
    let b = f("_");
    taint.Sink(b);
}
function f(t: string) {
    return t;
}
