import { taint } from "./taint_mock"
/**
 * Introduction 循环结构-update语句
 */

export function for_update_002_F(taint_src : string) {
  let clean = ""
  let _t = taint_src;
  let ini = 0
  let j = "_"
  for (; ini < 2; j = "_") {
    clean = j
    ini++
  }
  taint.Sink(clean);
}
