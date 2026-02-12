import { taint } from "./taint_mock"

/**
 * Introduction 路径长度
 */
export function field_len_004_F(taint_src : string) {
  class A {
    b : B
    constructor () {this.b = new B()}
  }

  class B {
    c : C
    constructor () {this.c = new C()}

  }

  class C {
    d : D
    constructor () {this.d = new D()}
  }

  class D {
    e : E
    constructor () {this.e = new E()}
  }

  class E {
    f : F
    constructor () {this.f = new F()}
  }

  class F {
    g : G
    constructor () {this.g = new G()}
  }

  class G {
    h : H
    constructor () {this.h = new H()}
  }

  class H {
    i : I
    constructor () {this.i = new I()}
  }

  class I {
    j : J
    constructor () {this.j = new J()}
  }

  class J {
    k : K
    constructor () {this.k = new K()}
  }

  class K {
    l : L
    constructor () {this.l = new L()}
  }

  class L {
    data : string
    clean : string

    constructor () {
      this.data = taint_src
      this.clean = "_"
    }
  }
  let a = new A();
  taint.Sink(a.b.c.d.e.f.g.h.i.j.k.l.clean);
}
