import { taint } from "./taint_mock";

/**
 * Introduction 返回值传�?
 */
export function return_value_passing_001_T(taint_src : string) {
  let t = f(taint_src);
  taint.Sink(t);
}
function f(t : string) {
  return t;
}
