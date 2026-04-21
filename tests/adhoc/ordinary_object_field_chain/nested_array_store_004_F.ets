import { taint } from "./taint_mock";

export function nested_array_store_004_F(taint_src: string) {
  const nested: string[] = [];
  nested[0] = "_";
  const wrapper: string[][] = [];
  wrapper[1] = nested;
  taint.Sink(wrapper[1][0]);
  void taint_src;
}
