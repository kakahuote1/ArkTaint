import { taint } from "./taint_mock";

export function ctor_helper_writeback_003_T(taint_src: string): void {
  class Holder {
    value: string = "clean";

    constructor(v: string) {
      this.init(v);
    }

    private init(v: string): void {
      this.value = v;
    }
  }

  const holder = new Holder(taint_src);
  taint.Sink(holder.value);
}
