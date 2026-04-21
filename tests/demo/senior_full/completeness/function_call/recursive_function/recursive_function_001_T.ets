import { taint } from "./taint_mock";
/**
 * Introduction 递归函数
 */

export function recursive_function_001_T(taint_src : string) {
  let t = recursiveFunc(taint_src,3);
  taint.Sink(t);
}
function recursiveFunc(input: string, depth: number) : string {
  if (depth > 0) {
    return recursiveFunc(input, depth - 1)
  } else {
    return input
  }
}
