import { taint } from "./taint_mock";

export function weakmap_get_002_F(taint_src: string) {
  const map = new WeakMap<object, string>();
  const key = {};
  map.set(key, "_");
  taint.Sink(map.get(key));
}
