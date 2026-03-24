import { taint } from "./taint_mock";

export function object_keys_001_F(taint_src: string) {
  const obj = { a: taint_src, b: "_" };
  const keys = Object.keys(obj);
  taint.Sink(keys.at(0)!);
}
