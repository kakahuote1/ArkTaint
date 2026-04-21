import { taint } from "./taint_mock";

export function structured_clone_002_F(taint_src: string) {
  const unused = { secret: taint_src };
  const payload = { secret: "_" };
  const copy = structuredClone(payload);
  taint.Sink(copy.secret);
  void unused;
}
