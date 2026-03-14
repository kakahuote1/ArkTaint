import { taint } from "./taint_mock";
/**
 * Introduction 递归函数
 */

export function recursive_function_002_F(taint_src : string) {
  let _t = taint_src;
  let _clean = "clean";
  let t = recursiveFunc(_clean,3);
  taint.Sink(t);
}
function recursiveFunc(input: string, depth: number) : string {
  if (depth > 0) {
    return recursiveFunc(input, depth - 1)
  } else {
    return input
  }
}
