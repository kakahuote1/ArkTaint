import { taint } from "./taint_mock";
/**
 * Introduction 参数传�?rest参数
 */

export function argument_passing_006_F(taint_src : string) {
  let _t = taint_src;
  f("a","b","_");
}
function f(...arg : string[]) {
  taint.Sink(arg[2]);
}
