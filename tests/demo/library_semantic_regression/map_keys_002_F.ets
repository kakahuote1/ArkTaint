import { taint } from "./taint_mock";

export function map_keys_002_F(taint_src: string) {
  let map = new Map<string, string>();
  map.set("_", "t");
  map.set("tt", "a");
  taint.Sink(map.keys());
}
