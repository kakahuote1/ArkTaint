import { taint } from "./taint_mock";

export function structured_clone_001_T(taint_src: string) {
  const payload = { secret: taint_src };
  const copy = structuredClone(payload);
  taint.Sink(copy.secret);
}
