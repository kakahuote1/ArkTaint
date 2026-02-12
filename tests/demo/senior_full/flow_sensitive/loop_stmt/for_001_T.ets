import { taint } from "./taint_mock"
/**
 * Introduction 循环结构-for
 */

export function for_001_T(taint_src : string) {
  let res = ""
  for (let i = 0; i < 1; i++) {
    res = taint_src
    taint.Sink(res)
  }
}
