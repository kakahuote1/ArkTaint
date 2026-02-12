import { taint } from "./taint_mock";


/**
 * Introduction 库函�?string_valueOf
 */
export function string_lib_func_005_T(taint_src : string) {
  let t = taint_src.valueOf();
  taint.Sink(t);
}
