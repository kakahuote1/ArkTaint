import { taint } from "./taint_mock";

export function map_stringify_get_022_F(taint_src: string): void {
  const map = new Map<string, string>();
  const info = JSON.stringify("clean");
  map.set("hot", info);
  taint.Sink(map.get("hot")!);
  void taint_src;
}
