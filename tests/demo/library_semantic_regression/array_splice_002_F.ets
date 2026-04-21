import { taint } from "./taint_mock";

export function array_splice_002_F(taint_src: string) {
  const arr = ["_", "_"];
  const removed = arr.splice(0, 1);
  taint.Sink(removed.at(0)!);
}
