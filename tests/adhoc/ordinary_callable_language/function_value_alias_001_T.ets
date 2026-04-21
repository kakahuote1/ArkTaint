import { taint } from "./taint_mock";

function sinkFn(data: string): void {
  taint.Sink(data);
}

export function function_value_alias_001_T(taint_src: string): void {
  const fp = sinkFn;
  fp(taint_src);
}
