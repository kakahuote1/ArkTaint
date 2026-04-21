import { taint } from "./taint_mock";

export function object_entries_002_F(taint_src: string) {
  const obj = { a: "_", b: "x" };
  const entries = Object.entries(obj);
  taint.Sink(entries.at(0)!);
}
