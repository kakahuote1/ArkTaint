import { taint } from "./taint_mock";
import cross_file_004_F_a from "./cross_file_004_F_a";

/**
 * Introduction export-default/import
 */
export default function cross_file_004_F_b(taint_src : string) {
  let _t = taint_src;
  let clean = cross_file_004_F_a("_");
  taint.Sink(clean);
}
