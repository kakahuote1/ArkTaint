import { taint } from "./taint_mock";

/**
 * Introduction return value passing - context-sensitive negative
 */
export function return_value_passing_002_F(taint_src: string) {
  const fromTaint = buildValue(taint_src);
  const fromClean = buildValue("clean");
  taint.Sink(fromClean);
}

function buildValue(value: string) {
  return value;
}
