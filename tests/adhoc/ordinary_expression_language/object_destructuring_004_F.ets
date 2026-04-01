import { taint } from "./taint_mock";

export function object_destructuring_004_F(taint_src: string) {
  const payload = { clean: "x", secret: "safe" };
  const { secret: extracted } = payload;
  taint.Sink(extracted);
}
