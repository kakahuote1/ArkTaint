import { taint } from "./taint_mock";

export function json_roundtrip_001_T(taint_src: string) {
  const payload = { seed: taint_src, clean: "_" };
  const serialized = JSON.stringify(payload);
  const parsed = JSON.parse(serialized);
  taint.Sink(parsed.seed);
}
