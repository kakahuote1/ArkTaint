import { taint } from "./taint_mock";

export function array_splice_001_T(taint_src: string) {
  const arr = [taint_src, "_"];
  const removed = arr.splice(0, 1);
  taint.Sink(removed.at(0)!);
}
