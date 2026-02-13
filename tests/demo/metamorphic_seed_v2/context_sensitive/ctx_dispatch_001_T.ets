import { taint } from "./taint_mock";

export function ctx_dispatch_001_T(taint_src: string) {
  let forwarded = taint_src;
  let out = relay(forwarded);
  taint.Sink(out);
}

function relay(v: string): string {
  return v;
}
