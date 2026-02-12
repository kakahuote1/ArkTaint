import { taint } from "./taint_mock";
/**
 * Introduction 异常抛出-try�?
 */

export function exception_try_002_F(taint_src : string) {
  try {
    let _t = taint_src;
    let clean = "_";
    taint.Sink(clean);
  } catch (e) {}
}
