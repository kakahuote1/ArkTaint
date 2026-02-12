import { taint } from "./taint_mock";

/**
 * Introduction 条件语句-switch
 */
export function conditional_switch_002_F(taint_src : string) {
  let _t = taint_src;
  let clean = "_";
  switch (2) {
    case 2:
      taint.Sink(clean)
  }
}
