import { taint } from "./taint_mock";
/**
 * Introduction 异常抛出-catch�?
 */

export function exception_catch_001_T(taint_src : string) {
  try {
    throw new Error();
  } catch (e) {
    taint.Sink(taint_src);
  }
}
