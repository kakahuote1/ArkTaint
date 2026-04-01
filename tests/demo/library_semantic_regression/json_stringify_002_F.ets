import { taint } from "./taint_mock";

export function json_stringify_002_F(taint_src: string) {
  const payload = { seed: "_", clean: "_" };
  const serialized = JSON.stringify(payload);
  taint.Sink(serialized);
  void taint_src;
}
