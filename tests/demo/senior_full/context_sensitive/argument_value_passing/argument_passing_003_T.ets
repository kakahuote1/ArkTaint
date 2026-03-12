import { taint } from "./taint_mock";

/**
 * Introduction argument passing position - context-sensitive positive
 */
export function argument_passing_003_T(taint_src: string) {
  const fromFirst = selectFirst(taint_src, "clean");
  const fromSecond = selectFirst("clean", taint_src);
  taint.Sink(fromFirst);
}

function selectFirst(a: string, b: string) {
  return a;
}
