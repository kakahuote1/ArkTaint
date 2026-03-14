import { taint } from "./taint_mock";

/**
 * Introduction 别名
 */
export function alias_002_F(taint_src : string) {
  let _t = taint_src;
  let a = new A();
  let b = a;
  b.data = "_";
  taint.Sink(a.data);
}
class A {
  data: string = "";
}
