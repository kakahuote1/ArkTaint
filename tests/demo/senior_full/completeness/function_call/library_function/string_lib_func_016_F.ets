import { taint } from "./taint_mock";


/**
 * Introduction 库函�?string_trim
 */
export function string_lib_func_016_F(taint_src : string) {
  let clean = "clean";
  let t = clean.trim();
  taint.Sink(t);
}
