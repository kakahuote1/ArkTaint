import { taint } from "./taint_mock";

/**
 * 参数传递：taint_src 直接传入 f，在 f 内 sink
 */
export function argument_passing_001_T(taint_src: string) {
    f(taint_src);
}
function f(t: string) {
    taint.Sink(t);
}
