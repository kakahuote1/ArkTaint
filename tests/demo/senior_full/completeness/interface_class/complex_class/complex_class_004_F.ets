import { taint } from "./taint_mock";

/**
 * Introduction cross-class access
 */
export function complex_class_004_F(taint_src: string) {
  let clean = "clean";
  let b = new B();
  let a = new A(clean);
  taint.Sink(b.getData(a));
}

class A {
  data: string;

  constructor(s: string) {
    this.data = s;
  }
}

class B {
  getData(a: A) {
    return a.data;
  }
}
