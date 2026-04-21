import { taint } from "./taint_mock";

export function static_initializer_side_effect_006_F(taint_src: string): void {
  class Holder {
    static shared: string = "clean";
  }

  taint.Sink(Holder.shared);
  void taint_src;
}
