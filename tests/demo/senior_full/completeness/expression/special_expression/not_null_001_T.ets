import { taint } from "./taint_mock";

/**
 * Introduction 非空断言操作�?
 */
export function not_null_001_T(taint_src : string) {
  let a = new A(taint_src);
  taint.Sink(a!.data);
}
class A {
  data: string;

  constructor(t : string) {
    this.data = t;
  }
}
