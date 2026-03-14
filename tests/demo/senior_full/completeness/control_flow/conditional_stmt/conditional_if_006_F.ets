import { taint } from "./taint_mock";

/**
 * Introduction else-if branch body
 */
export function conditional_if_006_F(taint_src: string) {
  let result = "";
  if (false) {
    result = "unused";
  } else if (true) {
    result = "clean";
  }
  taint.Sink(result);
}
