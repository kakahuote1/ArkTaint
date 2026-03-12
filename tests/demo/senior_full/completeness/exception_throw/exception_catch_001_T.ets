import { taint } from "./taint_mock";

/**
 * Introduction catch block body
 */
export function exception_catch_001_T(taint_src: string) {
  let result = "";
  try {
    throw new Error();
  } catch (e) {
    result = taint_src;
  }
  taint.Sink(result);
}
