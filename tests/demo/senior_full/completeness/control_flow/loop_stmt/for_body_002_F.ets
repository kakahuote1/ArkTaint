import { taint } from "./taint_mock"
/**
 * Introduction 循环结构-body语句
 */

export function for_body_002_F(taint_src : string) {
  let clean = ""
  let _t = taint_src;
  for (let i = 0; i < 2; i++) {
    clean = "_"
  }
  taint.Sink(clean)
}
