import { taint } from "./taint_mock";

/**
 * Introduction for-loop update order - flow-sensitive positive
 */
export function for_005_T(taint_src: string) {
  let res = "";
  for (let i = 0; i < 1; i++, res = taint_src) {
  }
  taint.Sink(res);
}
