import { taint } from "./taint_mock";

export function promise_then_callback_alias_002_F(taint_src: string): void {
  const cb = (_value: string): void => {
    taint.Sink("_");
  };
  const handler = cb;
  Promise.resolve(taint_src).then(handler);
}
