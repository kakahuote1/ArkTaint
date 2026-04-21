import { taint } from "./taint_mock";

export function string_replace_005_T(taint_src: string) {
  const out = taint_src.replace("a", "b");
  taint.Sink(out);
}
