import { taint } from "./taint_mock";

function makeCatchSink(): (reason: string) => void {
  return (reason: string): void => {
    taint.Sink(reason);
  };
}

export function promise_catch_returned_callback_010_F(taint_src: string): void {
  void taint_src;
  Promise.reject("safe").catch(makeCatchSink());
}
