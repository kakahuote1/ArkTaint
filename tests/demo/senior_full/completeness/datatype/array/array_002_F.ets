import { taint } from '../../../../pages/taint';
/**
 * Introduction 数组类型
 */
export function array_002_F(taint_src : string[]) : void {
  let _t = taint_src;
  let _clean = ["a","b","c"];
  taint.Sink(_clean);
}
