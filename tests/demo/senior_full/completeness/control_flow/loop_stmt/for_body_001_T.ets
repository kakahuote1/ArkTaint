import { taint } from "./taint_mock"
/**
 * Introduction 循环结构-body语句
 */

export function for_body_001_T(taint_src : string) {
  let t = ""
  for (let i = 0; i < 2; i++) {
    t = taint_src
  }
  taint.Sink(t)
}
