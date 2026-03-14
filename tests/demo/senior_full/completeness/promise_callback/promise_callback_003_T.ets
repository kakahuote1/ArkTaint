import { taint } from "./taint_mock";
/**
 * Introduction 异步-Promise-catch
 */

export function promise_callback_003_T(taint_src : string) {
  let p = f(taint_src);
  p.then((result) => {}).catch((error : string) => {
    taint.Sink(error);
  })
}
async function f(t : string): Promise<string> {
  return new Promise((resolve,reject) => {
    reject(t);
  });
}
