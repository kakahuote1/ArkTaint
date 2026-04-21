import { taint } from "./taint_mock";

export function weakset_add_base_002_F(taint_src: object): void {
  const set = new WeakSet<object>();
  const clean = {};
  set.add(clean);
  taint.Sink(set);
}
