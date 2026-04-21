import { taint } from "./taint_mock";

export function promise_reject_002_F(taint_src: string) {
  const p = Promise.reject("_");
  p.catch(reason => {
    taint.Sink(reason);
  });
}
