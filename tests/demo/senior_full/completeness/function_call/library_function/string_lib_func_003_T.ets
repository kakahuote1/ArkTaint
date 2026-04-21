import { taint } from "./taint_mock";


/**
 * Introduction 库函�?string_toString
 */
export function string_lib_func_003_T(taint_src : string) {
  let t = taint_src.toString();
  taint.Sink(t);
}
