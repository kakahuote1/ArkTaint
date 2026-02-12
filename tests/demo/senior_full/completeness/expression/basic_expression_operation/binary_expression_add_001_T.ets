import { taint } from "./taint_mock";
/**
 * Introduction 基础表达式运�?二元运算-�?
 */

export function binary_expression_add_001_T(taint_src : string) {
  let t = taint_src + "_";
  taint.Sink(t);
}
