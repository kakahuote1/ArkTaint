import { taint } from "./taint_mock";

export function extracted_nested_alias_009_T(taint_src: string): void {
  const nested = { seed: taint_src };
  const wrapper: any = {};
  wrapper.inner = nested;
  const inner = wrapper.inner;
  taint.Sink(inner.seed);
}
