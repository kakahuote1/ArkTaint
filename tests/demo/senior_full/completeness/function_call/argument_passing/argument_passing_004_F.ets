import { taint } from "./taint_mock";

/**
 * Introduction default argument passing
 */
export function argument_passing_004_F(taint_src: string) {
  let clean = "clean";
  f(clean);
}

function f(t: string = "default_value") {
  taint.Sink(t);
}
