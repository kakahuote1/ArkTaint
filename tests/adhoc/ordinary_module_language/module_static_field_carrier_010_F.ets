import { taint } from "./taint_mock";
import { getStaticPayload, setStaticPayload } from "./shared_object";

export function module_static_field_carrier_010_F(taint_src: string): void {
  const payload = {
    seed: "_",
    other: taint_src,
  };
  setStaticPayload(payload);
  taint.Sink(getStaticPayload().seed);
}
