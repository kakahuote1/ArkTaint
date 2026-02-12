import { taint } from "./taint_mock";
/**
 * Introduction 参数传�?参数位置
 */

export function argument_passing_003_T(taint_src : string) {
  f(taint_src,"_");
}
function f(a : string, b : string) {
  taint.Sink(a);
}
