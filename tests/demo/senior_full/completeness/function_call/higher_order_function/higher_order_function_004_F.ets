import { taint } from "./taint_mock";
/**
 * Introduction 高阶函数-二阶
 */

export function higher_order_function_004_F(taint_src : string) {
  let _t = taint_src;
  let _clean = "clean";
  taint.Sink(f44(g4)(_clean,"a"));
}
function f44(g: Function) : Function {
  return g()
}

function g4() : Function {
  return (a: string, b: string) => {
    return a + b
  }
}
