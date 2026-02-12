import { taint } from "./taint_mock";

/**
 * Introduction 条件语句-else if
 */
export function conditional_if_005_T(taint_src : string) {
  if (false) {}
  else if(true){
    taint.Sink(taint_src)
  }
  else {}
}
