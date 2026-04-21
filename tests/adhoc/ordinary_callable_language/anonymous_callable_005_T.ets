import { taint } from "./taint_mock";

export function anonymous_callable_005_T(taint_src: string): void {
  const fp = function (data: string): void {
    taint.Sink(data);
  };
  fp(taint_src);
}
