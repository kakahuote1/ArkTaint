import { taint } from "./taint_mock";

export function array_slice_copy_007_T(taint_src: string) {
  const arr = [taint_src, "_"];
  const copy = arr.slice(0);
  taint.Sink(copy.at(0)!);
}
