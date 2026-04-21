import { taint } from "./taint_mock";

export function array_from_001_T(taint_src: string) {
  const src = [taint_src, "_"];
  const copy = Array.from(src);
  taint.Sink(copy.at(0)!);
}
