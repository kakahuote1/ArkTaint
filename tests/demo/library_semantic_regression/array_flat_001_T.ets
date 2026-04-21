import { taint } from "./taint_mock";

export function array_flat_001_T(taint_src: string) {
  const arr = [taint_src, "_"];
  const flat = arr.flat();
  taint.Sink(flat.at(0)!);
}
