import { taint } from "./taint_mock";
/**
 * Introduction 异步-Promise-finally
 */

export function promise_callback_005_T(taint_src : string) {
  let p = f(taint_src);
  let t = "";
  p.then((result) => {t = result}).catch((error : string) => {}).finally(() => {
    taint.Sink(t);
  })
}
async function f(t : string): Promise<string> {
  return new Promise((resolve) => {
    resolve(t);
  });
}
