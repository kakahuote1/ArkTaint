import { taint } from "./taint_mock";
/**
 * Introduction 函数重载-多�?
 * Level 2
 */

export function polymorphism_002_F(taint_src : string) {
  let sub = new Sub2()
  taint.Sink(sub.call(taint_src));
}
class Base {
}

class Sub1 extends Base {
  call(t : string) {
    return t
  }
}

class Sub2 extends Base {
  call(t : string) {
    return '_'
  }
}
