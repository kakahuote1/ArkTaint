import { taint } from "./taint_mock";

export function set_values_001_T(taint_src: string) {
  let s = new Set<string>();
  s.add(taint_src);
  taint.Sink(s.values());
}
