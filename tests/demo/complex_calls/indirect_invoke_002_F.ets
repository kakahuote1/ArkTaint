import { taint } from "./taint_mock";

function sinkFn(data: string): void {
  taint.Sink(data);
}

export function indirect_invoke_002_F(taint_src: string) {
  let fp = sinkFn;
  fp("_");
}
