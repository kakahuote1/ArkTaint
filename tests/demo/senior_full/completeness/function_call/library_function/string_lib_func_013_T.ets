import { taint } from "./taint_mock";


/**
 * Introduction 库函�?string_split
 */
export function string_lib_func_013_T(taint_src : string) {
  let t = taint_src.split("f");
  taint.Sink(t);
}
