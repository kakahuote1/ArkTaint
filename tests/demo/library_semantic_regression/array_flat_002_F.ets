import { taint } from "./taint_mock";

export function array_flat_002_F(taint_src: string) {
  const arr = ["_", "_"];
  const flat = arr.flat();
  taint.Sink(flat.at(0)!);
}
