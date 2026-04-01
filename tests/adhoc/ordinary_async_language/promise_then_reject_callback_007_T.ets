import { taint } from "./taint_mock";

export function promise_then_reject_callback_007_T(taint_src: string): void {
  Promise.reject(taint_src).then(
    (): void => {},
    (reason: string): void => {
      taint.Sink(reason);
    },
  );
}
