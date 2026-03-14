import { taint } from "./taint_mock";


/**
 * Introduction 库函�?string_toLowerCase
 */
export function string_lib_func_019_T(taint_src : string) {
  let t = taint_src.toLowerCase();
  taint.Sink(t);
}
