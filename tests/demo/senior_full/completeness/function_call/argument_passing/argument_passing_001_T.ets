import { taint } from "./taint_mock";
/**
 * Introduction 参数传�?普通参数传�?
 */

export function argument_passing_001_T(taint_src : string) {
  f(taint_src);
}
function f(t : string) {
  taint.Sink(t);
}
