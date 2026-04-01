import { taint } from "./taint_mock";

export function ctor_helper_writeback_004_F(taint_src: string): void {
  class Holder {
    value: string = "clean";

    constructor(v: string) {
      this.init(v);
    }

    private init(_v: string): void {
      this.value = "clean";
    }
  }

  const holder = new Holder(taint_src);
  taint.Sink(holder.value);
}
