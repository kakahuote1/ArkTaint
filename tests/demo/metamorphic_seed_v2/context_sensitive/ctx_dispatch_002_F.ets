import { taint } from "./taint_mock";

export function ctx_dispatch_002_F(taint_src: string) {
  let forwarded = taint_src;
  let clean = "clean";
  let out = relay(clean);
  taint.Sink(out);
}

function relay(v: string): string {
  return v;
}
