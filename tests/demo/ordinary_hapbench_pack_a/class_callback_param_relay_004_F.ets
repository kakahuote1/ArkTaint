import { taint } from "./taint_mock";

function invokeValue(_callback: (value: string) => void, _value: string): void {}

class EntryHolder {
  onCreate(): void {
    const taint_src = "secret";
    invokeValue((value: string): void => {
      taint.Sink(value);
    }, taint_src);
  }
}

export function class_callback_param_relay_004_F(): void {
  new EntryHolder().onCreate();
}
