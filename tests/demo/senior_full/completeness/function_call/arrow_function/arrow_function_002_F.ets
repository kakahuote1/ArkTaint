import { taint } from "./taint_mock";
/**
 * Introduction 箭头函数-一�?
 */

export function arrow_function_002_F(taint_src : string) {
  let _t = taint_src;
  let _clean = "clean";
  let arrowFunction2 = (t : string): void => taint.Sink(t)
  arrowFunction2(_clean);
}
