import { taint } from "./taint_mock";

export function field_initializer_001_T(taint_src: string): void {
  class Holder {
    value: string = taint_src;
  }

  const holder = new Holder();
  taint.Sink(holder.value);
}
