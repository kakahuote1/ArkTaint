import { taint } from "./taint_mock";

/**
 * Introduction 条件语句-else if
 */
export function conditional_if_006_F(taint_src : string) {
  let _t = taint_src;
  let clean = "_";
  if (false) {}
  else if(true){
    taint.Sink(clean)
  }
  else {}
}
