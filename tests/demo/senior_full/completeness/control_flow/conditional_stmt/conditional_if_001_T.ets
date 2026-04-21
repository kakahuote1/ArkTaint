import { taint } from "./taint_mock";

/**
 * Introduction if branch body
 */
export function conditional_if_001_T(taint_src: string) {
  let result = "";
  if (true) {
    result = taint_src;
  }
  taint.Sink(result);
}
