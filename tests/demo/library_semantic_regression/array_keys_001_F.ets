import { taint } from "./taint_mock";

export function array_keys_001_F(taint_src: string) {
  const arr = [taint_src, "_"];
  const keys = Array.from(arr.keys());
  taint.Sink(keys.at(0)!);
}
