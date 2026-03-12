import { taint } from "./taint_mock";

/**
 * Introduction primitive string
 */
export function primitives_string_001_T(taint_src: string): void {
  taint.Sink(taint_src);
}
