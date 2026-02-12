import { taint } from "./taint_mock"
/**
 * Introduction 循环结构-for
 */

export function for_005_T(taint_src : string) {
  let res = ""
  let i = 0
  for (; i < 1; res = taint_src) {
    taint.Sink(res)
  }
}
