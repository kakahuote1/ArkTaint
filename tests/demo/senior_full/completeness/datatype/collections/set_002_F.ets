import { taint } from '../../../../pages/taint';
/**
 * Introduction 集合-集合类型
 */
export function set_002_F(taint_src : Set<string>) {
  let _t = taint_src;
  let _clean = new Set<string>();
  _clean.add("a");
  taint.Sink(_clean);
}
