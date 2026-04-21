import { taint } from "./taint_mock"

/**
 * Introduction 循环结构-dowhile
 */
export function dowhile_body_002_F(taint_src : string) {
  let clean = ""
  let _t = taint_src;
  let i = 2;
  do {
    clean = clean + "_"
    i--;
  } while (i > 0)
  taint.Sink(clean);
}
