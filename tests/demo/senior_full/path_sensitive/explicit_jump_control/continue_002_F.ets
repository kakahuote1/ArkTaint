import { taint } from "./taint_mock"

/**
 * Introduction 显式跳转控制-continue
 */
export function continue_002_F(taint_src : string) {
  let res = ''
  for (let i = 0; i < 10; i++) {
    if (i === 3) {
      res = taint_src
      continue
      taint.Sink(res)
    }
  }
}
