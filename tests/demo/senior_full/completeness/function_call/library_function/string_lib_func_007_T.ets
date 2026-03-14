import { taint } from "./taint_mock";


/**
 * Introduction 库函�?string_replace
 */
export function string_lib_func_007_T(taint_src : string) {
  let t = taint_src.replace("a","b");
  taint.Sink(t);
}
