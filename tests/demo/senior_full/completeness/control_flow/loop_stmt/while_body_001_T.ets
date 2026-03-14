import { taint } from "./taint_mock";

/**
 * Introduction 循环结构-body语句
 */
export function while_body_001_T(taint_src : string) {
  let i = 0
  let t = ''
  while (i < 2) {
    t = t + taint_src
    i++
  }
  taint.Sink(t);
}
