import { taint } from "./taint_mock"
/**
 * Introduction 异常抛出-try�?
 */

export function exception_throw_002_F(taint_src : string) {
  try {
    throw new Error()
    taint.Sink(taint_src)
  } catch (e) {
  }
}
