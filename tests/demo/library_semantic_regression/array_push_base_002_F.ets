import { taint } from "./taint_mock";

export function array_push_base_002_F(taint_src: string): void {
  const arr: string[] = ["a", "b"];
  arr.push("_");
  taint.Sink(arr);
}
