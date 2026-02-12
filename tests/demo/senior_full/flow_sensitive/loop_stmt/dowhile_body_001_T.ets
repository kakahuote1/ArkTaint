import { taint } from "./taint_mock"

/**
 * Introduction 循环结构-dowhile
 */
export function dowhile_body_001_T(taint_src : string) {
  let res = ""
  do {
    res = taint_src
    taint.Sink(res)
  } while (res !== taint_src)
}
