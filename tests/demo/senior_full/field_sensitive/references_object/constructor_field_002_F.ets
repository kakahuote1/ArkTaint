import { taint } from "./taint_mock";
/**
 * Introduction 构造函�?
 */

export function constructor_field_002_F(taint_src : string) {
  class A {
    data: string;
    clean: string;
    constructor(t : string) {
      this.data = t;
      this.clean = "_";
    }
  }
  let a = new A(taint_src);
  taint.Sink(a.clean);
}
