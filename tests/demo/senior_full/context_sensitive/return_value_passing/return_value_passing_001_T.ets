import { taint } from "./taint_mock";

/**
 * Introduction return value passing - context-sensitive positive
 */
export function return_value_passing_001_T(taint_src: string) {
  const fromTaint = buildValue(taint_src);
  const fromClean = buildValue("clean");
  taint.Sink(fromTaint);
}

function buildValue(value: string) {
  return value;
}
