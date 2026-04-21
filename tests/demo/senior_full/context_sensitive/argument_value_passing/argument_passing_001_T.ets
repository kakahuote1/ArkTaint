import { taint } from "./taint_mock";

/**
 * Introduction argument passing - context-sensitive positive
 */
export function argument_passing_001_T(taint_src: string) {
  const fromTaint = forward(taint_src);
  const fromClean = forward("clean");
  taint.Sink(fromTaint);
}

function forward(value: string) {
  return value;
}
