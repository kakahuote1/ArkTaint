import { taint } from "./taint_mock";

export function map_stringify_get_021_T(taint_src: string): void {
  const map = new Map<string, string>();
  const info = JSON.stringify(taint_src);
  map.set("hot", info);
  taint.Sink(map.get("hot")!);
}
