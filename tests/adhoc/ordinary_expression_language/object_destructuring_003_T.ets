import { taint } from "./taint_mock";

export function object_destructuring_003_T(taint_src: string) {
  const payload = { clean: "x", secret: taint_src };
  const { secret: extracted } = payload;
  taint.Sink(extracted);
}
