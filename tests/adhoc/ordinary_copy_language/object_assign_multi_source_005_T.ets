import { taint } from "./taint_mock";

export function object_assign_multi_source_005_T(taint_src: string) {
  const copy = Object.assign({}, { keep: "_" }, { secret: taint_src });
  taint.Sink(copy.secret);
}
