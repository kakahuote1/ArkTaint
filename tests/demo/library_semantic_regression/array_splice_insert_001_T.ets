import { taint } from "./taint_mock";

export function array_splice_insert_001_T(taint_src: string) {
  const arr = ["_"];
  arr.splice(1, 0, taint_src);
  taint.Sink(arr.at(1)!);
}
