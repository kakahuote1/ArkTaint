import { taint } from "./taint_mock";

/**
 * Introduction 循环结构-body语句
 */
export function while_body_002_F(taint_src : string) {
  let clean = ""
  let _t = taint_src;
  let i = 0
  while (i < 2) {
    clean = clean + "_"
    i++
  }
  taint.Sink(clean);
}
