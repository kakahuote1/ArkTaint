import { taint } from "./taint_mock";

export function object_alias_load_008_F(taint_src: string): void {
  const nested = { seed: "_" };
  const wrapper: any = {};
  wrapper.inner = nested;
  const alias = wrapper;
  taint.Sink(alias.inner.seed);
  void taint_src;
}
