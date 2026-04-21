import { taint } from "./taint_mock";

export function array_slice_copy_008_F(taint_src: string) {
  const unused = [taint_src];
  const arr = ["_", "_"];
  const copy = arr.slice(0);
  taint.Sink(copy.at(0)!);
  void unused;
}
