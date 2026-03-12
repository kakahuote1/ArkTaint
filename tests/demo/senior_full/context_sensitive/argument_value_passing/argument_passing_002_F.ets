import { taint } from "./taint_mock";

/**
 * Introduction argument passing - context-sensitive negative
 */
export function argument_passing_002_F(taint_src: string) {
  const fromTaint = forward(taint_src);
  const fromClean = forward("clean");
  taint.Sink(fromClean);
}

function forward(value: string) {
  return value;
}
