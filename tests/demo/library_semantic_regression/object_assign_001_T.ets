import { taint } from "./taint_mock";

export function object_assign_001_T(taint_src: string) {
  const src = { seed: taint_src, clean: "_" };
  const copy = Object.assign({}, src);
  taint.Sink(copy.seed);
}
