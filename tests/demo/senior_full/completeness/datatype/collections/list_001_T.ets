import { taint } from '../../../../pages/taint';
import { List } from '@kit.ArkTS';
/**
 * Introduction 集合-列表类型
 */
export function list_001_T(taint_src : List<string>) {
  taint.Sink(taint_src);
}
