import { taint } from "./taint_mock";
/**
 * Introduction 箭头函数-二阶
 */

export function arrow_function_003_T(taint_src : string) {
  let outer1 = () => {
    return (t : string) => {
      taint.Sink(t)
    }
  }
  let arrowfunc3 = outer1();
  arrowfunc3(taint_src);
}
