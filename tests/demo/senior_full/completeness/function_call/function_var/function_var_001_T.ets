import { taint } from "./taint_mock";
/**
 * Introduction 变量函数
 */

export function function_var_001_T(taint_src : string){
  let f = taint.Sink;
  f(taint_src);
}
