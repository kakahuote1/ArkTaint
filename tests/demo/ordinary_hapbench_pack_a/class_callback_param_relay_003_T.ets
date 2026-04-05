import { taint } from "./taint_mock";

function invokeValue(callback: (value: string) => void, value: string): void {
  callback(value);
}

class EntryHolder {
  onCreate(): void {
    const taint_src = "secret";
    invokeValue((value: string): void => {
      taint.Sink(value);
    }, taint_src);
  }
}

export function class_callback_param_relay_003_T(): void {
  new EntryHolder().onCreate();
}
