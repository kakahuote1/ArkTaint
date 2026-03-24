import { taint } from "./taint_mock";

export function weakmap_get_001_T(taint_src: string) {
  const map = new WeakMap<object, string>();
  const key = {};
  map.set(key, taint_src);
  taint.Sink(map.get(key));
}
