import { taint } from "./taint_mock";
/**
 * Introduction 变量函数
 */

export function function_var_003_T(taint_src : string){
  let f1 = ff;
  f1(taint_src);
}
function ff(t : string) {
  taint.Sink(t)
}
