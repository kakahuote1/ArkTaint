import { taint } from '../../../../pages/taint';

/**
 * Introduction map type
 */
export function map_001_T(taint_src: Map<string, string>) {
  taint.Sink(taint_src);
}
