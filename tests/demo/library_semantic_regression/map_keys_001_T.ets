import { taint } from "./taint_mock";

export function map_keys_001_T(taint_src: string) {
  let map = new Map<string, string>();
  map.set(taint_src, "t");
  map.set("tt", "a");
  taint.Sink(map.keys());
}
