import { taint } from "./taint_mock";


/**
 * Introduction 库函�?string_slice
 */
export function string_lib_func_010_F(taint_src : string) {
  let clean = "clean";
  let t = clean.slice(0,1);
  taint.Sink(t);
}
