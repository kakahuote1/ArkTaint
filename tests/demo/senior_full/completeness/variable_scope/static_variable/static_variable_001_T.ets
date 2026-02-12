import { taint } from "./taint_mock";
/**
 * Introduction 类静态变�?
 */

export function static_variable_001_T(taint_src : string) {

  A.data = taint_src;
  taint.Sink(A.data);
}
class A {
  static data: string;
}
