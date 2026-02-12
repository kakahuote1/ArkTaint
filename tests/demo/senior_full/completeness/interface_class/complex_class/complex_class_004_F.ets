import { taint } from "./taint_mock";

/**
 * Introduction 跨类访问
 */
export function complex_class_001_T(taint_src : string) {
  let _t = taint_src
  let _clean = "clean"
  let b = new B();
  let a = new A(_clean);
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
