import { taint } from "./taint_mock";

function callbackWithSink(taint_src: string): void {
  taint.Sink(taint_src);
}

export function callback_receiver_method_004_F(taint_src: string) {
  const cb = callbackWithSink;
  cb.toString();
}
