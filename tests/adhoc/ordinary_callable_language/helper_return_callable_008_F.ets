import { taint } from "./taint_mock";

function makeSinker(): (data: string) => void {
  return (data: string): void => {
    taint.Sink(data);
  };
}

export function helper_return_callable_008_F(taint_src: string): void {
  const fp = makeSinker();
  fp("_");
}
