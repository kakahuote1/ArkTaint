import { taint } from "./taint_mock";

export function string_replace_006_F(taint_src: string) {
  const out = "clean".replace("a", "b");
  taint.Sink(out);
}
