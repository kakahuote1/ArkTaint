import { taint } from "./taint_mock";

export function array_destructuring_001_T(taint_src: string) {
  const values = ["clean", taint_src];
  const [first, second] = values;
  taint.Sink(second);
}
