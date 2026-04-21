import { taint } from "./taint_mock";

function invokeNow(_callback: () => void): void {}

class EntryHolder {
  onCreate(): void {
    invokeNow((): void => {
      const taint_src = "secret";
      taint.Sink(taint_src);
    });
  }
}

export function class_callback_source_inside_helper_002_F(): void {
  new EntryHolder().onCreate();
}
