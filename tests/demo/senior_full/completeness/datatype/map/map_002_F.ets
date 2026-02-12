import { taint } from '../../../../pages/taint';
/**
 * Introduction map类型
 */
function map_002_F(taint_src : Map<string,string>) {
  let _t  = taint_src;
  let _clean = new Map<string,string>();
  _clean.set("a","b");
  taint.Sink(_clean);
}
