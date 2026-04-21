import { taint } from "./taint_mock";

export function object_alias_load_007_T(taint_src: string): void {
  const nested = { seed: taint_src };
  const wrapper: any = {};
  wrapper.inner = nested;
  const alias = wrapper;
  taint.Sink(alias.inner.seed);
}
