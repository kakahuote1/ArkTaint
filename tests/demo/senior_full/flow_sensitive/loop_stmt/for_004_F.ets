import { taint } from "./taint_mock";

/**
 * Introduction for-loop init order - flow-sensitive negative
 */
export function for_004_F(taint_src: string) {
  let res = "";
  for (recordInitValue(res); false; ) {
    res = taint_src;
  }
}

function recordInitValue(value: string) {
  taint.Sink(value);
  return 0;
}
