import { taint } from "./taint_mock";

export function weakset_add_base_001_T(taint_src: object): void {
  const set = new WeakSet<object>();
  set.add(taint_src);
  taint.Sink(set);
}
