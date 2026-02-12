import { taint } from "./taint_mock";
/**
 * Introduction 参数传�?普通参数传�?
 */

export function argument_passing_002_F(taint_src : string) {
  let _t = taint_src
  let _clean = "clean"
  f(_clean);
}
function f(t : string) {
  taint.Sink(t);
}
