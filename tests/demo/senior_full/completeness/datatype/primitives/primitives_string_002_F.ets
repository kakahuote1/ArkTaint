import { taint } from "./taint_mock";

/**
 * Introduction primitive string
 */
export function primitives_string_002_F(taint_src: string): void {
  let _t = taint_src;
  let _clean = 'clean';
  taint.Sink(_clean);
}
