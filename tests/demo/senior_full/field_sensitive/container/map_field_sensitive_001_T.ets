import { taint } from "./taint_mock";

/**
 * Introduction Map域敏�?
 */
export function map_field_sensitive_001_T(taint_src : string) {
  let map = new Map<string,string>();
  map.set("key1", taint_src)
  map.set("key2", "clean")
  taint.Sink(map.get("key1")!);
}
