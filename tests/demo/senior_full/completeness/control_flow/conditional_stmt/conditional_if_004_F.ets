import { taint } from "./taint_mock";

/**
 * Introduction else branch body
 */
export function conditional_if_004_F(taint_src: string) {
  let result = "";
  if (false) {
    result = "unused";
  } else {
    result = "clean";
  }
  taint.Sink(result);
}
