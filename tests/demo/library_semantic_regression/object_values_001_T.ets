import { taint } from "./taint_mock";

export function object_values_001_T(taint_src: string) {
  const obj = { a: taint_src, b: "_" };
  const values = Object.values(obj);
  taint.Sink(values.at(0)!);
}
