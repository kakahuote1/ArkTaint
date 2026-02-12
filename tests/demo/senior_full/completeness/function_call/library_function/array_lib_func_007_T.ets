import { taint } from "./taint_mock";

/**
 * Introduction 库函�?array_shift
 */
export function array_lib_func_007_T(taint_src : string) {
  let arr : string[] = [taint_src,"a","b"];
  let t = arr.shift();
  taint.Sink(t!);
}
