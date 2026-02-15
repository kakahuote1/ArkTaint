import { taint } from "./taint_mock";

function target(data: string): void {
  taint.Sink(data);
}

export function function_apply_001_T(taint_src: string) {
  target.apply(undefined, [taint_src]);
}
