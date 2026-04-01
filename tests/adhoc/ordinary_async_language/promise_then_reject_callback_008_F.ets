import { taint } from "./taint_mock";

export function promise_then_reject_callback_008_F(taint_src: string): void {
  void taint_src;
  Promise.reject("safe").then(
    (): void => {},
    (reason: string): void => {
      taint.Sink(reason);
    },
  );
}
