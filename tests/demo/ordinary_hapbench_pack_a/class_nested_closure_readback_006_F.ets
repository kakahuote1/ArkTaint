import { taint } from "./taint_mock";

class EntryHolder {
  onCreate(): void {
    const taint_src = "secret";
    const leak = (): void => {
      taint.Sink("clean");
    };
    leak();
    void taint_src;
  }
}

export function class_nested_closure_readback_006_F(): void {
  new EntryHolder().onCreate();
}
