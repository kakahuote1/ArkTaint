import { taint } from "./taint_mock";
import { cross_file_001_T_a } from "./cross_file_001_T_a";

/**
 * Introduction export/import
 */
export function cross_file_001_T_b (taint_src : string) {
  let t = cross_file_001_T_a(taint_src);
  taint.Sink(t);
}
