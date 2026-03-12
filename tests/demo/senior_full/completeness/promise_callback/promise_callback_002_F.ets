import { taint } from "./taint_mock";

/**
 * Introduction async Promise then
 */
export function promise_callback_002_F(taint_src: string) {
  let clean = "clean";
  let p = f(clean);
  p.then((result) => {
    taint.Sink(result);
  });
}

async function f(t: string): Promise<string> {
  return new Promise((resolve) => {
    resolve(t);
  });
}
