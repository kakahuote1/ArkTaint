import { taint } from "./taint_mock";

function target(data: string): void {
  taint.Sink(data);
}

export function function_bind_001_T(taint_src: string) {
  const bound = target.bind(undefined, taint_src);
  bound();
}
