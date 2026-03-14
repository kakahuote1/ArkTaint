import { taint } from "./taint_mock"
/**
 * Introduction 循环结构-update语句
 */

export function for_update_001_T(taint_src : string) {
  let t = ""
  let ini = 0
  let j = "_"
  for (; ini < 2; j = taint_src) {
    t = j
    ini++
  }
  taint.Sink(t);
}
