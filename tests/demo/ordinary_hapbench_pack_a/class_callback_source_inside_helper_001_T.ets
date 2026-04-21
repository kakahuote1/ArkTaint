import { taint } from "./taint_mock";

function invokeNow(callback: () => void): void {
  callback();
}

class EntryHolder {
  onCreate(): void {
    invokeNow((): void => {
      const taint_src = "secret";
      taint.Sink(taint_src);
    });
  }
}

export function class_callback_source_inside_helper_001_T(): void {
  new EntryHolder().onCreate();
}
