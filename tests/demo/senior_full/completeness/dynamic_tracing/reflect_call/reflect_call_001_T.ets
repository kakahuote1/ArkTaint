import { taint } from "./taint_mock";
/**
 * Introduction 动态方法调�?反射
 */

export function reflect_call_001_T(taint_src : string) {
  class A {
    data: string = taint_src;
  }
  let a = new A();
  taint.Sink(Reflect.get(a,"data"));
}
