import { taint } from "./taint_mock";

export function anonymous_object_field_callable_015_T(taint_src: string): void {
  const sinker = (data: string): void => {
    taint.Sink(data);
  };
  const holder = {
    run: sinker,
  };
  const alias = holder;
  const fp = alias.run;
  fp(taint_src);
}
