import { taint } from "./taint_mock";

export function array_of_002_F(taint_src: string) {
  const arr = Array.of("_", "_");
  taint.Sink(arr.at(1)!);
}
