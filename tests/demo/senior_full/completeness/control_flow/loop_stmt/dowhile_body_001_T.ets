import { taint } from "./taint_mock"

/**
 * Introduction 循环结构-dowhile
 */
export function dowhile_body_001_T(taint_src : string) {
  let t = ""
  let i = 2;
  do {
    t = t + taint_src
    i--;
  } while (i > 0)
  taint.Sink(t);
}
