import { taint } from "./taint_mock";
/**
 * Introduction 链式调用
 */

export function chained_call_002_F(taint_src : string) {

  new A().setData("_").clearData().setData("clean").f();
}
class A {
  data : string;

  constructor() {
    this.data = "";
  }
  setData(data : string) {
    this.data = data;
    return this;
  }
  clearData() {
    this.data = "";
    return this;
  }
  f() {
    taint.Sink(this.data);
  }
}
