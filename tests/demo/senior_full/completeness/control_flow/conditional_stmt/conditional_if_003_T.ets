import { taint } from "./taint_mock";

/**
 * Introduction else branch body
 */
export function conditional_if_003_T(taint_src: string) {
  let result = "";
  if (false) {
    result = "unused";
  } else {
    result = taint_src;
  }
  taint.Sink(result);
}
