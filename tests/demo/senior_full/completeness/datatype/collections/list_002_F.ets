import { taint } from '../../../../pages/taint';
import { List } from '@kit.ArkTS';
/**
 * Introduction 集合-列表类型
 */
export function list_002_F(taint_src : List<string>) {
  let _t = taint_src;
  let _clean = new List<string>();
  _clean.add("a");
  taint.Sink(_clean);
}
