import { taint } from "./taint_mock";

export function static_initializer_side_effect_005_T(taint_src: string): void {
  class Holder {
    static shared: string = taint_src;
  }

  taint.Sink(Holder.shared);
}
