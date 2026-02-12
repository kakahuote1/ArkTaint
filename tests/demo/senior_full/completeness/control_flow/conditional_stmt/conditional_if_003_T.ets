import { taint } from "./taint_mock";

/**
 * Introduction 条件语句-else
 */
export function conditional_if_003_T(taint_src : string) {
  if (false) {
  } else {
    taint.Sink(taint_src);
  }
}
