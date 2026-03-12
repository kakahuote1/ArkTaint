import { taint } from "./taint_mock";

/**
 * Introduction finally block body
 */
export function exception_finally_001_T(taint_src: string) {
  let result = "";
  try {}
  catch (e) {}
  finally {
    result = taint_src;
  }
  taint.Sink(result);
}
