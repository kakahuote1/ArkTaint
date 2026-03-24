import { taint } from "./taint_mock";

export function promise_all_001_T(taint_src: string) {
  const p = Promise.resolve(taint_src);
  Promise.all([p]).then(results => {
    taint.Sink(results[0]);
  });
}
