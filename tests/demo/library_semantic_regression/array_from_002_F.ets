import { taint } from "./taint_mock";

export function array_from_002_F(taint_src: string) {
  const src = ["_", "_"];
  const copy = Array.from(src);
  taint.Sink(copy.at(0)!);
}
