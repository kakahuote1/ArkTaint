import { taint } from "./taint_mock";

/**
 * Introduction 库函�?array_push
 */
export function array_lib_func_005_T(taint_src : string) {
  let arr : string[] = ["a","b"];
  arr.push(taint_src);
  taint.Sink(arr);
}
