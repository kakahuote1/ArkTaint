import { taint } from "./taint_mock";
/**
 * Introduction 循环结构-init语句
 */

export function for_init_001_T(taint_src : string) {
  let ini = "";
  let t = "";
  let j = 0;
  for (ini = taint_src; j < 2; j++) {
    t = t + ini;
  }
  taint.Sink(t);
}
