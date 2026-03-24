import { taint } from "./taint_mock";

export function promise_race_001_T(taint_src: string) {
  const p = Promise.resolve(taint_src);
  Promise.race([p]).then(result => {
    taint.Sink(result);
  });
}
