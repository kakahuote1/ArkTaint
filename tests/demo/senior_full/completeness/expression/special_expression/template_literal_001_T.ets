import { taint } from "./taint_mock";
/**
 * Introduction 模板字面�?
 */

export function template_literal_001_T(taint_src : string) {
  let t =`_${taint_src}`;
  taint.Sink(t);
}
