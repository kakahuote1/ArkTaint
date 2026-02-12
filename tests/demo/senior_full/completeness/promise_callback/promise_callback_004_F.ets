import { taint } from "./taint_mock";
/**
 * Introduction 异步-Promise-catch
 */

export function promise_callback_004_F(taint_src : string) {
  let _t = taint_src;
  let clean = "clean";
  let p = f(clean);
  p.then((result) => {}).catch((error : string) => {
    taint.Sink(error);
  })
}
async function f(t : string): Promise<string> {
  return new Promise((resolve,reject) => {
    reject(t);
  });
}
