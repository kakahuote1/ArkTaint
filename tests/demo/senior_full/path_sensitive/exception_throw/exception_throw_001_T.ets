import { taint } from "./taint_mock"
/**
 * Introduction 异常抛出-try�?
 */

export function exception_throw_001_T(taint_src : string) {
  try {
    taint.Sink(taint_src)
    throw new Error()
  } catch (e) {
  }
}
