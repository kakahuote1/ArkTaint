import { taint } from "./taint_mock";

/**
 * Introduction 库函�?array_pop
 */
export function array_lib_func_004_F(taint_src : string) {
  let arr : string[] = ["a","b","_"];
  let t = arr.pop();
  taint.Sink(t!);
}
