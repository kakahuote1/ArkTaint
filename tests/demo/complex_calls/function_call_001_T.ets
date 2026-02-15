import { taint } from "./taint_mock";

function target(data: string): void {
  taint.Sink(data);
}

export function function_call_001_T(taint_src: string) {
  target.call(undefined, taint_src);
}
