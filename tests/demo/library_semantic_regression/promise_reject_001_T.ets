import { taint } from "./taint_mock";

export function promise_reject_001_T(taint_src: string) {
  const p = Promise.reject(taint_src);
  p.catch(reason => {
    taint.Sink(reason);
  });
}
