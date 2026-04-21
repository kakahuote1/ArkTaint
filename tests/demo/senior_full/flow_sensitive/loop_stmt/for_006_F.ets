import { taint } from "./taint_mock";

/**
 * Introduction for-loop update order - flow-sensitive negative
 */
export function for_006_F(taint_src: string) {
  let res = "";
  for (let i = 1; i < 1; i++, res = taint_src) {
  }
  taint.Sink(res);
}
