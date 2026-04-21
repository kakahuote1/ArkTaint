import { taint } from "./taint_mock"

/**
 * Introduction 路径长度
 */
export function field_len_003_T(taint_src : string) {
  let a = new A(taint_src);
  taint.Sink(a.b.c.d.e.f.g.h.i.j.k.l.data);
}
class A {
  b : B
  constructor (t : string) {this.b = new B(t)}
}

class B {
  c : C
  constructor (t : string) {this.c = new C(t)}

}

class C {
  d : D
  constructor (t : string) {this.d = new D(t)}
}

class D {
  e : E
  constructor (t : string) {this.e = new E(t)}
}

class E {
  f : F
  constructor (t : string) {this.f = new F(t)}
}

class F {
  g : G
  constructor (t : string) {this.g = new G(t)}
}

class G {
  h : H
  constructor (t : string) {this.h = new H(t)}
}

class H {
  i : I
  constructor (t : string) {this.i = new I(t)}
}

class I {
  j : J
  constructor (t : string) {this.j = new J(t)}
}

class J {
  k : K
  constructor (t : string) {this.k = new K(t)}
}

class K {
  l : L
  constructor (t : string) {this.l = new L(t)}
}

class L {
  data : string
  clean : string

  constructor (t : string) {
    this.data = t
    this.clean = "_"
  }
}
