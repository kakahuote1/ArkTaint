import { taint } from "./taint_mock";
/**
 * Introduction 高阶函数-二阶
 */

export function higher_order_function_003_T(taint_src : string) {
  taint.Sink(f33(g3)(taint_src,"a"));
}
function f33(g: Function) : Function {
  return g()
}

function g3() : Function {
  return (a: string, b: string) => {
    return a + b
  }
}
