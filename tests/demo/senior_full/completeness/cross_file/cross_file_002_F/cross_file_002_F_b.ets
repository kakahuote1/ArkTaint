import { taint } from "./taint_mock";
import { cross_file_002_F_a } from "./cross_file_002_F_a";
/**
 * Introduction export/import
 */

export function cross_file_002_F_b (taint_src : string) {
  let _t = taint_src;
  let clean = cross_file_002_F_a("_");
  taint.Sink(clean);
}
