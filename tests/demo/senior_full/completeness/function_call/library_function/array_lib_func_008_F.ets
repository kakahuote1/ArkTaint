import { taint } from "./taint_mock";

/**
 * Introduction 库函�?array_shift
 */
export function array_lib_func_008_F(taint_src : string) {
  let arr : string[] = ["_","a","b"];
  let t = arr.shift();
  taint.Sink(t!);
}
