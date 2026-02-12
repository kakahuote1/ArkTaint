import { taint } from '../../../../pages/taint';
import { Queue } from '@kit.ArkTS';
/**
 * Introduction 集合-队列类型
 */
export function queue_002_F(taint_src : Queue<string>) {
  let _t = taint_src;
  let _clean = new Queue<string>();
  _clean.add("a");
  taint.Sink(_clean);
}
