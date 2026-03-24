import { taint } from "./taint_mock";

export function map_set_base_001_T(taint_src: string): void {
  const map = new Map<string, string>();
  map.set("k", taint_src);
  taint.Sink(map);
}
