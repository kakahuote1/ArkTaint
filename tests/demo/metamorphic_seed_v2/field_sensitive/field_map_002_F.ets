import { taint } from "./taint_mock";

export function field_map_002_F(taint_src: string) {
  let table = new Map<string, string>();
  let payload = taint_src;
  table.set("token", payload);
  table.set("safe", "_");
  let out = table.get("safe");
  taint.Sink(out!);
}
