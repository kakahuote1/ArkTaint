import { taint } from "./taint_mock";
/**
 * Introduction 异步-Promise-then
 */

export function promise_callback_001_T(taint_src : string) {
  let _t = taint_src;
  let clean = "clean";
  let p = f(clean);
  p.then((result) => {
    taint.Sink(result);
  })
}
async function f(t : string): Promise<string> {
  return new Promise((resolve) => {
    resolve(t);
  });
}
