import { taint } from "./taint_mock";
/**
 * Introduction 函数类型
 */

export function function_001_T(taint_src : Function) {
  taint.Sink(taint_src)
}
