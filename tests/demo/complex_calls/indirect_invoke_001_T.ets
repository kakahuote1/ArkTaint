import { taint } from "./taint_mock";

function sinkFn(data: string): void {
  taint.Sink(data);
}

export function indirect_invoke_001_T(taint_src: string) {
  let fp = sinkFn;
  fp(taint_src);
}
