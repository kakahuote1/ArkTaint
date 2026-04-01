import { taint } from "./taint_mock";

export function nested_field_store_002_F(taint_src: string) {
  const nested = { seed: "_" };
  const wrapper: any = {};
  wrapper.inner = nested;
  taint.Sink(wrapper.inner.seed);
  void taint_src;
}
