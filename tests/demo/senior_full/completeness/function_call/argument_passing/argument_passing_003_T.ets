import { taint } from "./taint_mock";
/**
 * Introduction 参数传�?默认参数�?
 */

export function argument_passing_003_T(taint_src : string) {
  f(taint_src);
}
function f(t : string = "default_value") {
  taint.Sink(t);
}
