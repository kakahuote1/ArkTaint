import { taint } from "./taint_mock";
/**
 * Introduction 函数内部�?
 */

export function simple_class_005_T(taint_src : string) {
  class A {
    data: string;
    clean: string;
    constructor() {
      this.data = taint_src;
      this.clean = "_";
    }
  }
  let a = new A();
  taint.Sink(a.data);
}
