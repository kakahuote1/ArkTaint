import { taint } from "./taint_mock";
/**
 * Introduction 静态函�?
 */
export function static_function_002_F(taint_src : string) {
  let _t = taint_src;
  let _clean = "clean";

  A.f(_clean);
}
class A {
  static f(t : string) {
    taint.Sink(t);
  }
}
