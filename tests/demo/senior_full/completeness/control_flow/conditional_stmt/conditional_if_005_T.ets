import { taint } from "./taint_mock";

/**
 * Introduction else-if branch body
 */
export function conditional_if_005_T(taint_src: string) {
  let result = "";
  if (false) {
    result = "unused";
  } else if (true) {
    result = taint_src;
  }
  taint.Sink(result);
}
