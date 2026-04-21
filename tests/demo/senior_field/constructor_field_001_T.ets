import { taint } from "./taint_mock";
/**
 * Introduction 构造函�?
 */

export function constructor_field_001_T(taint_src : string) {
  let a = new A(taint_src);
  taint.Sink(a.data);
}
class A {
  data: string;
  clean: string;
  constructor(t : string) {
    this.data = t;
    this.clean = "_";
  }
}
