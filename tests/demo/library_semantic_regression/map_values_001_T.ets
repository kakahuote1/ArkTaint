import { taint } from "./taint_mock";

export function map_values_001_T(taint_src: string) {
  let map = new Map<string, string>();
  map.set("t", taint_src);
  map.set("tt", "a");
  taint.Sink(map.values());
}
