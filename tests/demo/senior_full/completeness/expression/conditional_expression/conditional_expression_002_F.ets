import { taint } from "./taint_mock";
/**
 * Introduction 条件表达�?
 */

export function conditional_expression_002_F(taint_src : string) {
  let _t = taint_src;
  let clean = true ? "a" : "_";
  taint.Sink(clean);
}
