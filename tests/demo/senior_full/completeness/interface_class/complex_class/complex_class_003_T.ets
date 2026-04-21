import { taint } from "./taint_mock";

/**
 * Introduction 跨类访问
 */
export function complex_class_003_T(taint_src : string) {
  let b = new B();
  let a = new A(taint_src);
  taint.Sink(b.getData(a));
}
class A {
  data : string;
  constructor(s : string) {
    this.data = s;
  }
}
class B {
  getData(a : A) {
    return a.data;
  }

}
