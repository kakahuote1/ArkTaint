import { taint } from "./taint_mock";
import { getStaticPayload, setStaticPayload } from "./shared_object";

export function module_static_field_carrier_009_T(taint_src: string): void {
  const payload = {
    seed: taint_src,
    other: "_",
  };
  setStaticPayload(payload);
  taint.Sink(getStaticPayload().seed);
}
