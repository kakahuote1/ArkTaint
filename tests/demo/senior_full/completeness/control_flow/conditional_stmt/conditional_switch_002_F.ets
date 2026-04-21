import { taint } from "./taint_mock";

/**
 * Introduction switch branch body
 */
export function conditional_switch_002_F(taint_src: string) {
  let result = "";
  switch (2) {
    case 2:
      result = "clean";
      break;
    default:
      result = "unused";
      break;
  }
  taint.Sink(result);
}
