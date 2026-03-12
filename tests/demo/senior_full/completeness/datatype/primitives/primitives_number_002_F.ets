import { taint } from "./taint_mock";

/**
 * Introduction primitive number
 */
export function primitives_number_002_F(taint_src: number): void {
  let _t: number = taint_src;
  let _clean = 1;
  taint.Sink(_clean);
}
