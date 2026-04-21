import { taint } from "./taint_mock";

export function promise_allSettled_001_T(taint_src: string) {
  const p = Promise.resolve(taint_src);
  Promise.allSettled([p]).then(results => {
    taint.Sink(results[0]);
  });
}
