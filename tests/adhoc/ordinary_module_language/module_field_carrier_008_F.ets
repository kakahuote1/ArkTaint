import { taint } from "./taint_mock";
import { getSharedBox, setSharedBox } from "./shared_object";

export function module_field_carrier_008_F(taint_src: string): void {
  const payload = {
    seed: "_",
    other: taint_src,
  };
  setSharedBox(payload);
  taint.Sink(getSharedBox().seed);
}
