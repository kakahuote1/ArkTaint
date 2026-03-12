import { taint } from "./taint_mock";

/**
 * Introduction finally block body
 */
export function exception_finally_002_F(taint_src: string) {
  let result = "";
  try {}
  catch (e) {}
  finally {
    result = "clean";
  }
  taint.Sink(result);
}
