import { taint } from "./taint_mock";
/**
 * Introduction 高阶函数-一�?
 */

export function higher_order_function_001_T(taint_src : string) {
  taint.Sink(f11()(taint_src,"a"));
}
function f11() {
  return (a: string, b: string) => {
    return a + b
  }
}
