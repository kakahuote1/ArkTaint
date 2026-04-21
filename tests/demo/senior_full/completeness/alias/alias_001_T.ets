import { taint } from "./taint_mock";

/**
 * Introduction 别名
 */
export function alias_001_T(taint_src : string) {

  let a = new A();
  let b = a;
  b.data = taint_src;
  taint.Sink(a.data);
}
class A {
  data: string = "";
}
