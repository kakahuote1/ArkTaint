import { taint } from "./taint_mock";

export function nested_object_relay_011_T(taint_src: string): void {
  const nested = { seed: taint_src };
  const wrapper1: any = {};
  wrapper1.inner = nested;

  const extracted = wrapper1.inner;
  const wrapper2: any = {};
  wrapper2.other = extracted;

  taint.Sink(wrapper2.other.seed);
}
