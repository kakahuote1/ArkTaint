import { taint } from "./taint_mock";

export function promise_resolve_002_F(taint_src: string) {
  const p = Promise.resolve("_");
  p.then(value => {
    taint.Sink(value);
  });
}
