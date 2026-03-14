import { taint } from "./taint_mock"
/**
 * Introduction 循环结构-body语句
 * Level 3
 */


export function while_body_001_T(taint_src : string) {
  let i = 0
  let res = ""
  while (i < 2) {
    res = taint_src
    i++
  }
  taint.Sink(res)
}
