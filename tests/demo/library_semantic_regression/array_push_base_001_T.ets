import { taint } from "./taint_mock";

export function array_push_base_001_T(taint_src: string): void {
  const arr: string[] = ["a", "b"];
  arr.push(taint_src);
  taint.Sink(arr);
}
