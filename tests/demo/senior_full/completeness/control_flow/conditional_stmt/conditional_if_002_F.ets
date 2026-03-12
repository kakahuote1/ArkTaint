import { taint } from "./taint_mock";

/**
 * Introduction if branch body
 */
export function conditional_if_002_F(taint_src: string) {
  let result = "";
  if (true) {
    result = "clean";
  }
  taint.Sink(result);
}
