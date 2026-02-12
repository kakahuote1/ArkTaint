import { taint } from '../../../../pages/taint';
/**
 * Introduction map类型
 */
function map_001_T(taint_src : Map<string,string>) {
  taint.Sink(taint_src);
}
