import { taint } from "./taint_mock";

export function local_function_alias_003_T(taint_src: string): void {
  function relay(data: string): void {
    taint.Sink(data);
  }

  const fp = relay;
  fp(taint_src);
}
