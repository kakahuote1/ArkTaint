import { taint } from "./taint_mock";

export function array_destructuring_002_F(taint_src: string) {
  const values = ["clean", "still_clean"];
  const [first, second] = values;
  taint.Sink(second);
}
