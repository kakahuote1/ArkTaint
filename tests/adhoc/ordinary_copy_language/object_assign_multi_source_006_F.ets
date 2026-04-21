import { taint } from "./taint_mock";

export function object_assign_multi_source_006_F(taint_src: string) {
  const unused = { secret: taint_src };
  const copy = Object.assign({}, { keep: "_" }, { secret: "_" });
  taint.Sink(copy.secret);
  void unused;
}
