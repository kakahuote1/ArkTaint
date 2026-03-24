import { taint } from "./taint_mock";

export function object_values_002_F(taint_src: string) {
  const obj = { a: "_", b: "x" };
  const values = Object.values(obj);
  taint.Sink(values.at(0)!);
}
