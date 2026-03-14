import { taint } from "./taint_mock";

/**
 * Introduction break control - path-sensitive negative
 */
export function break_002_F(taint_src: string) {
  let res = "clean";
  for (let i = 0; i < 2; i++) {
    if (i === 0) {
      break;
    }
    res = taint_src;
  }
  taint.Sink(res);
}
