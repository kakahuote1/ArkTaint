import { taint } from "./taint_mock";

/**
 * Introduction 基础表达式运�?赋值表达式
 */
export function assign_expression_002_F(taint_src : string) {
  let _t = taint_src;
  let clean = "clean";
  taint.Sink(clean);
}
