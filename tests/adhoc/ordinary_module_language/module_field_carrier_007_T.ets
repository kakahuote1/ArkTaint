import { taint } from "./taint_mock";
import { getSharedBox, setSharedBox } from "./shared_object";

export function module_field_carrier_007_T(taint_src: string): void {
  const payload = {
    seed: taint_src,
    other: "_",
  };
  setSharedBox(payload);
  taint.Sink(getSharedBox().seed);
}
