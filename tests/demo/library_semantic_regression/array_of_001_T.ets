import { taint } from "./taint_mock";

export function array_of_001_T(taint_src: string) {
  const arr = Array.of("_", taint_src);
  taint.Sink(arr.at(1)!);
}
