import { taint } from "./taint_mock";
/**
 * Introduction 变量函数
 */

export function function_var_006_F(taint_src : string){
  let _t = taint_src;
  let _clean = "clean";
  let a = new A();
  let f22 = a.ff;
  f22(_clean);
}
class A {
  ff(t : string) {
    taint.Sink(t);
  }
}
