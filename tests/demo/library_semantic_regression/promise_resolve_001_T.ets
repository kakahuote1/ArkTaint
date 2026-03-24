import { taint } from "./taint_mock";

export function promise_resolve_001_T(taint_src: string) {
  const p = Promise.resolve(taint_src);
  p.then(value => {
    taint.Sink(value);
  });
}
