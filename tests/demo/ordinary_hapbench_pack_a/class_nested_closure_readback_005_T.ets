import { taint } from "./taint_mock";

class EntryHolder {
  onCreate(): void {
    const taint_src = "secret";
    const leak = (): void => {
      taint.Sink(taint_src);
    };
    leak();
  }
}

export function class_nested_closure_readback_005_T(): void {
  new EntryHolder().onCreate();
}
