import { taint } from "./taint_mock";

export function ctor_static_state_007_T(taint_src: string): void {
  class Holder {
    static shared: string = "clean";

    constructor(v: string) {
      Holder.shared = v;
    }
  }

  void new Holder(taint_src);
  taint.Sink(Holder.shared);
}
