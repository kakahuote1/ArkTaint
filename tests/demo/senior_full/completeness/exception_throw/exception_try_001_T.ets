import { taint } from "./taint_mock";
/**
 * Introduction 异常抛出-try�?
 */

export function exception_try_001_T(taint_src : string) {
  try {
    taint.Sink(taint_src);
  } catch (e) {}
}
