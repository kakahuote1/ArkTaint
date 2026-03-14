import { taint } from "./taint_mock";

/**
 * Introduction function type
 */
export function function_001_T(taint_src: Function) {
  taint.Sink(taint_src);
}
