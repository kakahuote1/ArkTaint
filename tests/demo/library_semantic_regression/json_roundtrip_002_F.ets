import { taint } from "./taint_mock";

export function json_roundtrip_002_F(taint_src: string) {
  const payload = { seed: "_", clean: "_" };
  const serialized = JSON.stringify(payload);
  const parsed = JSON.parse(serialized);
  taint.Sink(parsed.seed);
  void taint_src;
}
