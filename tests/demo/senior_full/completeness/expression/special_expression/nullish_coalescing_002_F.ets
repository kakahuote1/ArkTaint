import { taint } from "./taint_mock";

/**
 * Introduction 空合并运算符
 */
export function nullish_coalescing_002_F(taint_src : string) {
  let _t = taint_src;
  let clean = null ?? "_";
  taint.Sink(clean);
}
