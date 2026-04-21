import { taint } from "./taint_mock";

export function promise_any_001_T(taint_src: string) {
  const p = Promise.resolve(taint_src);
  Promise.any([p]).then(result => {
    taint.Sink(result);
  });
}
