import { taint } from "./taint_mock";
import cross_file_003_T_a from "./cross_file_003_T_a";

/**
 * Introduction export-default/import
 */
export default function cross_file_003_T_b(taint_src : string) {
  let t = cross_file_003_T_a(taint_src);
  taint.Sink(t);
}
