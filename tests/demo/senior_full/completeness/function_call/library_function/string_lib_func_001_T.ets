import { taint } from "./taint_mock";


/**
 * Introduction 库函�?string_concat
 */
export function string_lib_func_001_T(taint_src : string) {
  let t = taint_src.concat("_");
  taint.Sink(t);
}
