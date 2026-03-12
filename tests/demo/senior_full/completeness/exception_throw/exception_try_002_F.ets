import { taint } from "./taint_mock";

/**
 * Introduction try block body
 */
export function exception_try_002_F(taint_src: string) {
  let result = "";
  try {
    result = "clean";
  } catch (e) {}
  taint.Sink(result);
}
