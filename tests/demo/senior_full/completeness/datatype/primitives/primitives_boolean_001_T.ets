import { taint } from "./taint_mock";

/**
 * Introduction primitive boolean
 */
export function primitives_boolean_001_T(taint_src: boolean): void {
  taint.Sink(taint_src);
}
