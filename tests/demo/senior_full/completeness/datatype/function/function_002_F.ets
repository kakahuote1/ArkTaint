import { taint } from "./taint_mock";
/**
 * Introduction 函数类型
 */
export function function_002_F(taint_src : Function) {
  let _t = taint_src;
  let _clean = f;
  taint.Sink(_clean)
}
function f(){}
