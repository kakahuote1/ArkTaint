import { taint } from "./taint_mock";

/**
 * Introduction function type
 */
export function function_002_F(taint_src: Function) {
  let _t = taint_src;
  let _clean = fallback;
  taint.Sink(_clean);
}

function fallback() {}
