import { taint } from '../../../../pages/taint';

/**
 * Introduction array type
 */
export function array_002_F(taint_src: string[]): void {
  let _t = taint_src;
  let _clean = ['a', 'b', 'c'];
  taint.Sink(_clean);
}
