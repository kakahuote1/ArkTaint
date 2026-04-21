import { taint } from "./taint_mock";

export function nested_array_store_003_T(taint_src: string) {
  const nested: string[] = [];
  nested[0] = taint_src;
  const wrapper: string[][] = [];
  wrapper[1] = nested;
  taint.Sink(wrapper[1][0]);
}
