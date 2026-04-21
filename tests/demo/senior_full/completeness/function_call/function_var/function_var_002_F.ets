import { taint } from "./taint_mock";
/**
 * Introduction 变量函数
 */

export function function_var_002_F(taint_src : string){
  let _t = taint_src;
  let _clean = "clean";
  let f = taint.Sink;
  f(_clean);
}
