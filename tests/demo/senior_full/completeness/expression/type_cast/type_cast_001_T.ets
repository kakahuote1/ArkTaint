import { taint } from "./taint_mock";
/**
 * Introduction 类型转换
 */

export function type_cast_001_T(taint_src : string) {
  let t = Number(taint_src);
  taint.Sink(t);
}
