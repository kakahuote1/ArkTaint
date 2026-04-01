import { taint } from "./taint_mock";

export function nested_field_store_001_T(taint_src: string) {
  const nested = { seed: taint_src };
  const wrapper: any = {};
  wrapper.inner = nested;
  taint.Sink(wrapper.inner.seed);
}
