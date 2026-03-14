import { taint } from "./taint_mock";
/**
 * Introduction 箭头函数-二阶
 */

export function arrow_function_004_F(taint_src : string) {
  let _t = taint_src;
  let _clean = "clean";
  let outer2 = () => {
    return (t : string) => {
      taint.Sink(t)
    }
  }
  let arrowfunc4 = outer2();
  arrowfunc4(_clean);
}
