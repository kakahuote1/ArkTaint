import { taint } from "./taint_mock";

export function set_values_002_F(taint_src: string) {
  let s = new Set<string>();
  s.add("_");
  taint.Sink(s.values());
}
