import { taint } from "./taint_mock"

/**
 * Introduction 流敏�?常规语句-赋值表达式
 */
export function assign_expression_002_F(taint_src : string) {
  let result = ""
  taint.Sink(result)
  result = taint_src
}
