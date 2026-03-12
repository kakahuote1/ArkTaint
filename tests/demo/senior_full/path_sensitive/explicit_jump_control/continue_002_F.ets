import { taint } from "./taint_mock";

/**
 * Introduction continue control - path-sensitive negative
 */
export function continue_002_F(taint_src: string) {
  let res = "clean";
  for (let i = 0; i < 1; i++) {
    if (i === 0) {
      continue;
    }
    res = taint_src;
  }
  taint.Sink(res);
}
