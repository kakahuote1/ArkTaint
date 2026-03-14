import { taint } from "./taint_mock";
/**
 * Introduction 变量函数
 */

export function function_var_005_T(taint_src : string){
  let a = new A();
  let f2 = a.ff;
  f2(taint_src);
}
class A {
  ff(t : string) {
    taint.Sink(t);
  }
}
