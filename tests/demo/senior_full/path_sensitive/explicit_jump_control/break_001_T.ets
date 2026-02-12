import { taint } from "./taint_mock"

/**
 * Introduction 显式跳转控制-break
 */
export function break_001_T(taint_src : string) {
  let res = ''
  for (let i = 0; i < 10; i++) {
    if (i === 3) {
      res = taint_src
    }
    taint.Sink(res)
  }
}
