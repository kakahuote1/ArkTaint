import { taint } from "./taint_mock";

export function map_values_002_F(taint_src: string) {
  let map = new Map<string, string>();
  map.set("t", "_");
  map.set("tt", "a");
  taint.Sink(map.values());
}
