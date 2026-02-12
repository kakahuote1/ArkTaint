import { taint } from "./taint_mock";
/**
 * Introduction 静态函�?
 */
export function static_function_001_T(taint_src : string) {

  A.f(taint_src);
}
class A {
  static f(t : string) {
    taint.Sink(t);
  }
}
