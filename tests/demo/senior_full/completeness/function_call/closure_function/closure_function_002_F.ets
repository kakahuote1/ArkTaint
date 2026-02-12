import { taint } from "./taint_mock";
/**
 * Introduction 闭包
 */

export function closure_function_002_F(taint_src : string) {
  let _t = taint_src;
  let _clean = "clean";
  let z2 = f();
  z2(_clean);
}
function f(): (t : string) => void {
  let g = (t : string): void => { taint.Sink(t) };
  return g;
}
