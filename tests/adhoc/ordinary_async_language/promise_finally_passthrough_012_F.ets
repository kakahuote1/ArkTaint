import { taint } from "./taint_mock";

export function promise_finally_passthrough_012_F(taint_src: string): void {
  Promise.resolve(taint_src).finally((): void => {
    const safe = "safe";
    taint.Sink(safe);
  });
}
