import { taint } from "./taint_mock";
/**
 * Introduction 异步-Promise-finally
 */

export function promise_callback_006_F(taint_src : string) {
  let _t = taint_src;
  let clean = "clean";
  let p = f(clean);
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
