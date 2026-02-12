import { taint } from '../../../../pages/taint';
/**
 * Introduction 简单类字段
 */
export function simple_class_003_T(taint_src : string) : void {
  let a = new A(taint_src);
  taint.Sink(a.data);
}

export class A {
  data : string = "d"
  constructor(s : string) {
    this.data = s;
  }
}
