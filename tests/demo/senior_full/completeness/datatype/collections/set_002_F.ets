import { taint } from '../../../../pages/taint';

/**
 * Introduction collection set type
 */
export function set_002_F(taint_src: Set<string>) {
  let _t = taint_src;
  let _clean = new Set<string>();
  _clean.add('a');
  taint.Sink(_clean);
}
