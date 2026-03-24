import { taint } from "./taint_mock";

function target(data: string): void {
  taint.Sink(data);
}

export function function_bind_002_F(taint_src: string) {
  const bound = target.bind(undefined, "_");
  bound();
}
