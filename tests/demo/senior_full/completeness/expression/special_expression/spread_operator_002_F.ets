import { taint } from "./taint_mock";

/**
 * Introduction 扩展运算�?
 */
export function spread_operator_002_F(taint_src : string) {
  let _t = taint_src;
  let array1 = ['a', 'b', "_"];
  let array = ['c', ...array1];
  taint.Sink(array[3]);
}
