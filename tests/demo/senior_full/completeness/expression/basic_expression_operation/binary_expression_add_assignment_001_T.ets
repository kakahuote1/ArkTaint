import { taint } from "./taint_mock";
/**
 * Introduction 基础表达式运�?二元运算-加等
 */

export function binary_expression_add_assignment_001_T(taint_src : string) {
  let t = "_";
  t += taint_src;
  taint.Sink(t);
}
