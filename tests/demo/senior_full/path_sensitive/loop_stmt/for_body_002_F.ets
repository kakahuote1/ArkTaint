import { taint } from "./taint_mock"

/**
 * Introduction 循环结构-body语句
 */

export function for_body_002_F(taint_src : string) {
  let res = ""
  for (let i = 0; i < 0; i++) {
    res = taint_src
  }
  taint.Sink(res)
}
