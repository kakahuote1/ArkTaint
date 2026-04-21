import { taint } from "./taint_mock";

export function json_stringify_001_T(taint_src: string) {
  const payload = { seed: taint_src, clean: "_" };
  const serialized = JSON.stringify(payload);
  taint.Sink(serialized);
}
