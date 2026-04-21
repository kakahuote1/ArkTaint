import { taint } from "./taint_mock";

export function ctor_static_state_008_F(taint_src: string): void {
  class Holder {
    static shared: string = "clean";

    constructor(_v: string) {
      Holder.shared = "clean";
    }
  }

  void new Holder(taint_src);
  taint.Sink(Holder.shared);
}
