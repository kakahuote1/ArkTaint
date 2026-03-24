import { taint } from "./taint_mock";

export function object_entries_001_T(taint_src: string) {
  const obj = { a: taint_src, b: "_" };
  const entries = Object.entries(obj);
  taint.Sink(entries.at(0)!);
}
