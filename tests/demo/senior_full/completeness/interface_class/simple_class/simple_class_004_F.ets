import { taint } from '../../../../pages/taint';
/**
 * Introduction 简单类字段
 */
export function simple_class_004_F(taint_src : string) : void {
  let _t = taint_src;
  let _clean = new A("clean");
  taint.Sink(_clean.data);
}

export class A {
  data : string = "d"
  constructor(s : string) {
    this.data = s;
  }
}
