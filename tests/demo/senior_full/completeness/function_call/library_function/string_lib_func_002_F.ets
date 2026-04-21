import { taint } from "./taint_mock";


/**
 * Introduction 库函�?string_concat
 */
export function string_lib_func_002_F(taint_src : string) {
  let clean = "clean";
  let t = clean.concat("_");
  taint.Sink(t);
}
