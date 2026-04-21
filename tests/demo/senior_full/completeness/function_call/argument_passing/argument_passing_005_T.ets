import { taint } from "./taint_mock";
/**
 * Introduction 参数传�?rest参数
 */

export function argument_passing_005_T(taint_src : string) {
  f("a","b",taint_src);
}
function f(...arg : string[]) {
  taint.Sink(arg[2]);
}
