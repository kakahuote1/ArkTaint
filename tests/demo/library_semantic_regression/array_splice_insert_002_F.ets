import { taint } from "./taint_mock";

export function array_splice_insert_002_F(taint_src: string) {
  const arr = ["_"];
  arr.splice(1, 0, "_");
  taint.Sink(arr.at(1)!);
}
