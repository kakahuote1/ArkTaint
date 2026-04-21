import { taint } from "./taint_mock";

export function set_add_base_001_T(taint_src: string): void {
  const s = new Set<string>();
  s.add(taint_src);
  taint.Sink(s);
}
