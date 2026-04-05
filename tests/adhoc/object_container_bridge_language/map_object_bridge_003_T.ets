import { taint } from "./taint_mock";

export function map_object_bridge_003_T(taint_src: string): void {
  const hot = { payload: taint_src };
  const clean = { payload: "_" };
  const map = new Map<string, any>();
  map.set("hot", hot);
  map.set("clean", clean);
  taint.Sink(map.get("hot")!.payload);
}
