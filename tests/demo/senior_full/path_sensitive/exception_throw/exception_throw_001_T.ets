import { taint } from "./taint_mock";

/**
 * Introduction throw control - path-sensitive positive
 */
export function exception_throw_001_T(taint_src: string) {
  let result = "clean";
  try {
    result = taint_src;
    throw new Error();
  } catch (e) {
  }
  taint.Sink(result);
}
