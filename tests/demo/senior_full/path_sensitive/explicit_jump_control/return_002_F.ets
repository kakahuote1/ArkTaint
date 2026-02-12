import { taint } from "./taint_mock"

/**
 * Introduction 显式跳转控制- return-路径敏感
 */
export function return_002_F(taint_src : string) {
  process(taint_src,"some_condition")
}
function process (arg1: string, arg2: string) {
  if (arg2 === "some_condition") {
    return
  }
  taint.Sink(arg1)
}
