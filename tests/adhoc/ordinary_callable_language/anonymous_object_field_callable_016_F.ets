import { taint } from "./taint_mock";

export function anonymous_object_field_callable_016_F(taint_src: string): void {
  const sinker = (_data: string): void => {
    taint.Sink("clean");
  };
  const holder = {
    run: sinker,
  };
  const alias = holder;
  const fp = alias.run;
  fp(taint_src);
}
