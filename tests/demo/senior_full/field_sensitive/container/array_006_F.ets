import { taint } from "./taint_mock"

/**
 * Introduction 数组索引
 */
export function array_006_F(taint_src : string) {
  let arr = ["_", "a", taint_src, "b", "c"]
  taint.Sink(arr[1+2]);
}
