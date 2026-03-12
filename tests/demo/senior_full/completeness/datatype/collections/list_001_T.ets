import { taint } from '../../../../pages/taint';
import { List } from '@kit.ArkTS';

/**
 * Introduction collection list type
 */
export function list_001_T(taint_src: List<string>) {
  taint.Sink(taint_src);
}
