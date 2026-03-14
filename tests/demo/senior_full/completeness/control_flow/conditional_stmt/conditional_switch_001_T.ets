import { taint } from "./taint_mock";

/**
 * Introduction switch branch body
 */
export function conditional_switch_001_T(taint_src: string) {
  let result = "";
  switch (2) {
    case 2:
      result = taint_src;
      break;
    default:
      result = "clean";
      break;
  }
  taint.Sink(result);
}
