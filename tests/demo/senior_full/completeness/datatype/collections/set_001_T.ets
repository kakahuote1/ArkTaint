import { taint } from '../../../../pages/taint';
/**
 * Introduction 集合-集合类型
 */
export function set_001_T(taint_src : Set<string>) {
  taint.Sink(taint_src);
}
