import { taint } from '../../../../pages/taint';
import { Queue } from '@kit.ArkTS';
/**
 * Introduction 集合-队列类型
 */
export function queue_001_T(taint_src : Queue<string>) {
  taint.Sink(taint_src);
}
