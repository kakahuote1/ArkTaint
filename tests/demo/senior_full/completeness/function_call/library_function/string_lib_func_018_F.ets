import { taint } from "./taint_mock";


/**
 * Introduction 库函�?string_toUpperCase
 */
export function string_lib_func_018_F(taint_src : string) {
  let clean = "clean";
  let t = clean.toUpperCase();
  taint.Sink(t);
}
