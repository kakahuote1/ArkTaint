import { taint } from "./taint_mock";
import { getStaticSlot, setStaticSlot } from "./shared";

export function module_static_state_004_F(taint_src: string): void {
  setStaticSlot("_");
  taint.Sink(getStaticSlot());
}
