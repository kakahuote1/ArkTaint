import { taint } from "./taint_mock";

/**
 * Introduction nested field access
 */
export function complex_class_002_F(taint_src: string) {
  let clean = "clean";
  let b = new B();
  b.setData(clean);
  taint.Sink(b.data.getData());
}

class A {
  data: string;

  constructor(s: string) {
    this.data = s;
  }

  getData() {
    return this.data;
  }
}

class B {
  data: A;

  constructor() {
    this.data = new A("_");
  }

  setData(t: string) {
    this.data.data = t;
  }
}
