import { taint } from "./taint_mock";
/**
 * Introduction 闭包
 */

export function closure_function_001_T(taint_src : string) {
  let z1 = f();
  z1(taint_src);
}
function f(): (t : string) => void {
  let g = (t : string): void => { taint.Sink(t) };
  return g;
}
