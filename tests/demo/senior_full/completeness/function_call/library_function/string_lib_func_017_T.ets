import { taint } from "./taint_mock";


/**
 * Introduction 库函�?string_toUpperCase
 */
export function string_lib_func_017_T(taint_src : string) {
  let t = taint_src.toUpperCase();
  taint.Sink(t);
}
