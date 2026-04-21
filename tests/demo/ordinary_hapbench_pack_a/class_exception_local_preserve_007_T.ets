import { taint } from "./taint_mock";

class EntryHolder {
  onCreate(): void {
    let taint_src = "secret";
    try {
      throw new Error("boom");
    } catch (_error) {
      taint.Sink(taint_src);
    }
  }
}

export function class_exception_local_preserve_007_T(): void {
  new EntryHolder().onCreate();
}
