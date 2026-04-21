import { taint } from "./taint_mock";
import { getStaticSlot, setStaticSlot } from "./shared";

export function module_static_state_003_T(taint_src: string): void {
  setStaticSlot(taint_src);
  taint.Sink(getStaticSlot());
}
