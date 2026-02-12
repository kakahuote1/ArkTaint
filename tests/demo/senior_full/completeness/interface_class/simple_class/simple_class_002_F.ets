import { taint } from '../../../../pages/taint';
/**
 * Introduction 简单类对象
 */
export function simple_class_002_F(taint_src : A) : void {
  let _t = taint_src;
  let _clean = new A("clean");
  taint.Sink(_clean)
}

export class A {
  data : string = "d"
  constructor(s : string) {
    this.data = s;
  }
}
