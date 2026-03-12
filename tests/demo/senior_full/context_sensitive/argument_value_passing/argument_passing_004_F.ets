import { taint } from "./taint_mock";

/**
 * Introduction argument passing position - context-sensitive negative
 */
export function argument_passing_004_F(taint_src: string) {
  const fromClean = selectSecond(taint_src, "clean");
  const fromTaint = selectSecond("clean", taint_src);
  taint.Sink(fromClean);
}

function selectSecond(a: string, b: string) {
  return b;
}
