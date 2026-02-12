import { taint } from "./taint_mock";

/**
 * Introduction 空合并运算符
 */
export function nullish_coalescing_001_T(taint_src : string) {
  let t = null ?? taint_src;
  taint.Sink(t);
}
