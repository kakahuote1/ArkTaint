import { taint } from "./taint_mock";

/**
 * Introduction catch block body
 */
export function exception_catch_002_F(taint_src: string) {
  let result = "";
  try {
    throw new Error();
  } catch (e) {
    result = "clean";
  }
  taint.Sink(result);
}
