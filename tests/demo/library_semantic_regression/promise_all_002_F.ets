import { taint } from "./taint_mock";

export function promise_all_002_F(taint_src: string) {
  const p = Promise.resolve("_");
  Promise.all([p]).then(results => {
    taint.Sink(results[0]);
  });
}
