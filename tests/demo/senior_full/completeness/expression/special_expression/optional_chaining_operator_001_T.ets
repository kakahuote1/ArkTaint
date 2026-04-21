import { taint } from "./taint_mock";

/**
 * Introduction 可选链操作�?
 */
export function optional_chaining_operator_001_T(taint_src : string) {

  let a = new A(taint_src);
  taint.Sink(a?.data);
}

class A {
  data: string;

  constructor(t : string) {
    this.data = t;
  }
}
