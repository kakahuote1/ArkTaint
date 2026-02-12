import { taint } from '../../../../pages/taint';
/**
 * Introduction 简单类对象
 */
export function simple_class_001_T(taint_src : A) : void {
  let a = taint_src;
  taint.Sink(a);
}

export class A {
  data : string = "d"
  constructor(s : string) {
    this.data = s;
  }
}
