import { taint } from "./taint_mock";

export function field_initializer_002_F(taint_src: string): void {
  class Holder {
    value: string = "clean";
  }

  const holder = new Holder();
  taint.Sink(holder.value);
  void taint_src;
}
