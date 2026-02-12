import { taint } from "./taint_mock"

/**
 * Introduction 循环结构-dowhile
 */
export function dowhile_body_002_F(taint_src : string) {
  let res = ""
  do {
    taint.Sink(res)
    res = taint_src
  } while (res !== taint_src)
}
