import { taint } from "./taint_mock";

export function promise_then_callback_alias_001_T(taint_src: string): void {
  const cb = (value: string): void => {
    taint.Sink(value);
  };
  const handler = cb;
  Promise.resolve(taint_src).then(handler);
}
