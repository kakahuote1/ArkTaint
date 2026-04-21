import { taint } from '../../../../pages/taint';

/**
 * Introduction collection set type
 */
export function set_001_T(taint_src: Set<string>) {
  taint.Sink(taint_src);
}
