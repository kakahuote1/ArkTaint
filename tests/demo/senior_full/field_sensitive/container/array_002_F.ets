import { taint } from "./taint_mock"

/**
 * Introduction 数组索引
 */
export function array_002_F(taint_src : string) {
  let arr = [taint_src, "b", "c"]
  taint.Sink(arr[1]);
}
