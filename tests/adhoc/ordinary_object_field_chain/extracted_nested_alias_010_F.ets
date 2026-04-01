import { taint } from "./taint_mock";

export function extracted_nested_alias_010_F(taint_src: string): void {
  const nested = { seed: "_" };
  const wrapper: any = {};
  wrapper.inner = nested;
  const inner = wrapper.inner;
  taint.Sink(inner.seed);
  void taint_src;
}
