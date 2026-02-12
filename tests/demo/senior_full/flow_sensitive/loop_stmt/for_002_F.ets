import { taint } from "./taint_mock"
/**
 * Introduction 循环结构-for
 */

export function for_002_F(taint_src : string) {
  let res = ""
  for (let i = 0; i < 1; i++) {
    taint.Sink(res)
    res = taint_src
  }
}
