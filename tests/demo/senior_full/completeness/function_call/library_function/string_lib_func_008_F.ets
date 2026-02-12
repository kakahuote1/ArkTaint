import { taint } from "./taint_mock";


/**
 * Introduction 库函�?string_replace
 */
export function string_lib_func_008_F(taint_src : string) {
  let clean = "clean";
  let t = clean.replace("a","b");
  taint.Sink(t);
}
