import { taint } from "./taint_mock";

export function map_set_base_002_F(taint_src: string): void {
  const map = new Map<string, string>();
  map.set("k", "_");
  taint.Sink(map);
}
