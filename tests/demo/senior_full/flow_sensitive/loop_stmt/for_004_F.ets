import { taint } from "./taint_mock"
/**
 * Introduction 循环结构-for
 */

export function for_003_T(taint_src : string) {
  let res = ""
  let i = 0
  for (taint.Sink(res); i < 1; i++) {
    res = taint_src
  }
}
