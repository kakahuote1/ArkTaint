import { taint } from "./taint_mock";

/**
 * Introduction 循环结构-循环�?foreach
 */
export function foreach_001_T(taint_src : string) {
  let arr = ["a", "b", taint_src];
  arr.forEach(item => {
    taint.Sink(item);
  })
}
