import { taint } from '../../../../pages/taint';
import { Queue } from '@kit.ArkTS';

/**
 * Introduction collection queue type
 */
export function queue_001_T(taint_src: Queue<string>) {
  taint.Sink(taint_src);
}
