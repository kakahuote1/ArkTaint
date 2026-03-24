import { taint } from "./taint_mock";

export function set_add_base_002_F(taint_src: string): void {
  const s = new Set<string>();
  s.add("_");
  taint.Sink(s);
}
