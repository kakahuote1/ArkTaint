import { taint } from "./taint_mock";

/**
 * Introduction break control - path-sensitive positive
 */
export function break_001_T(taint_src: string) {
  let res = "clean";
  for (let i = 0; i < 2; i++) {
    if (i === 0) {
      res = taint_src;
      break;
    }
    res = "clean";
  }
  taint.Sink(res);
}
