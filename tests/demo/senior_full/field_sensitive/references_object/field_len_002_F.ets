import { taint } from "./taint_mock"

/**
 * Introduction 路径长度
 */

export function field_len_002_F(taint_src : string) {
  class A {
    b: B
    constructor () {
      this.b = new B()
    }
  }

  class B {
    c: C
    constructor () {
      this.c = new C()
    }
  }

  class C {
    data: string
    clean: string
    constructor () {
      this.data = taint_src
      this.clean = "_"
    }
  }
  let a = new A();
  taint.Sink(a.b.c.clean)
}
