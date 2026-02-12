import { taint } from "./taint_mock";


/**
 * Introduction 库函�?string_substring
 */
export function string_lib_func_012_F(taint_src : string) {
  let clean = "clean";
  let t = clean.substring(1,3);
  taint.Sink(t);
}
