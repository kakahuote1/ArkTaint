import { taint } from "./taint_mock";

export function anonymous_callable_006_F(taint_src: string): void {
  const fp = (data: string): void => {
    taint.Sink(data);
  };
  fp("_");
}
