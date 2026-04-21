import { taint } from "./taint_mock";

/**
 * Introduction try block body
 */
export function exception_try_001_T(taint_src: string) {
  let result = "";
  try {
    result = taint_src;
  } catch (e) {}
  taint.Sink(result);
}
