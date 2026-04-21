import { taint } from "./taint_mock"

/**
 * Introduction 路径长度
 */

export function field_len_001_T(taint_src : string) {
  let a = new A(taint_src);
  taint.Sink(a.b.c.data)
}
class A {
  b: B
  constructor (t1 : string) {
    this.b = new B(t1)
  }
}

class B {
  c: C
  constructor (t : string) {
    this.c = new C(t)
  }
}

class C {
  data: string
  clean: string
  constructor (t2 : string) {
    this.data = t2
    this.clean = "_"
  }
}
