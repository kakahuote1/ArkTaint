import { taint } from "./taint_mock";

export function object_assign_002_F(taint_src: string) {
  const src = { seed: "_", clean: "_" };
  const copy = Object.assign({}, src);
  taint.Sink(copy.seed);
  void taint_src;
}
