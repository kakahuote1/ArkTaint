import { taint } from "./taint_mock";

function makeRelay(): (data: string) => void {
  function relay(data: string): void {
    taint.Sink(data);
  }

  return relay;
}

export function local_function_factory_011_T(taint_src: string): void {
  const fp = makeRelay();
  fp(taint_src);
}
