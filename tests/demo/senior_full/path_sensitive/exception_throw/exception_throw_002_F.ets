import { taint } from "./taint_mock";

/**
 * Introduction throw control - path-sensitive negative
 */
export function exception_throw_002_F(taint_src: string) {
  let result = "clean";
  try {
    throw new Error();
    result = taint_src;
  } catch (e) {
  }
  taint.Sink(result);
}
