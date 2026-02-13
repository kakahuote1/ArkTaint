import { taint } from "./taint_mock";

export function field_map_001_T(taint_src: string) {
  let table = new Map<string, string>();
  let payload = taint_src;
  table.set("token", payload);
  table.set("safe", "_");
  let out = table.get("token");
  taint.Sink(out!);
}
