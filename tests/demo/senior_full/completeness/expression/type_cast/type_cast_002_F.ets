import { taint } from "./taint_mock";
/**
 * Introduction 类型转换
 */

export function type_cast_002_F(taint_src : string) {
  let _t = taint_src;
  let clean = Number("_");
  taint.Sink(clean);
}
