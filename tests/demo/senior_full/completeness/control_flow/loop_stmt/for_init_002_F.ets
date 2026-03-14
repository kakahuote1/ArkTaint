import { taint } from "./taint_mock";
/**
 * Introduction 循环结构-init语句
 */

export function for_init_002_F(taint_src : string) {
  let clean = ""
  let _t = taint_src;
  let ini = "";
  let j = 0;
  for (ini = "_"; j < 2; j++) {
    clean = clean + ini;
  }
  taint.Sink(clean);
}
