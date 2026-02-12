import { taint } from "./taint_mock";


/**
 * Introduction 库函�?string_trim
 */
export function string_lib_func_015_T(taint_src : string) {
  let t = taint_src.trim();
  taint.Sink(t);
}
