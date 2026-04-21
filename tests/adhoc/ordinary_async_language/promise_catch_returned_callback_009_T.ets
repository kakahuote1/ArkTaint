import { taint } from "./taint_mock";

function makeCatchSink(): (reason: string) => void {
  return (reason: string): void => {
    taint.Sink(reason);
  };
}

export function promise_catch_returned_callback_009_T(taint_src: string): void {
  Promise.reject(taint_src).catch(makeCatchSink());
}
