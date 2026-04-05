import { taint } from "./taint_mock";

export function callback_promise_then_003_T(taint_src: string) {
  Promise.resolve(taint_src).then(value => {
    taint.Sink(value);
  });
}
