import { taint } from "./taint_mock";

/**
 * Introduction 多次调用
 */
export function multi_invoke_001_T(taint_src : string) {
  let a = f(taint_src);
  let b = f("_");
  taint.Sink(a);
}
function f(t : string) {
  return t;
}
