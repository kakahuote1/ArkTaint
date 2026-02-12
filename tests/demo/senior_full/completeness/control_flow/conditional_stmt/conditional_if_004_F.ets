import { taint } from "./taint_mock";

/**
 * Introduction 条件语句-else
 */
export function conditional_if_004_F(taint_src : string) {
  let _t = taint_src;
  let clean = "_";
  if (false) {
  } else {
    taint.Sink(clean);
  }
}
