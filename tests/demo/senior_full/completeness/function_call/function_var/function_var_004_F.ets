import { taint } from "./taint_mock";
/**
 * Introduction 变量函数
 */

export function function_var_004_F(taint_src : string){
  let _t = taint_src;
  let _clean = "clean";
  let f11 = ff;
  f11(_clean);
}
function ff(t : string) {
  taint.Sink(t)
}
