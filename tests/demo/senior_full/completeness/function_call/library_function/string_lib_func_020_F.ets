import { taint } from "./taint_mock";


/**
 * Introduction 库函�?string_toLowerCase
 */
export function string_lib_func_020_F(taint_src : string) {
  let clean = "clean";
  let t = clean.toLowerCase();
  taint.Sink(t);
}
