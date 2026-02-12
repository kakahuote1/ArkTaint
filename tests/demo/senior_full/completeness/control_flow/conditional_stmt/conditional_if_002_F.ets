import { taint } from "./taint_mock";

/**
 * Introduction 条件语句-if
 */
export function conditional_if_002_F(taint_src : string) {
  let _t = taint_src;
  let clean = "_";
  if (true) {
    taint.Sink(clean)
  } else {}
}
