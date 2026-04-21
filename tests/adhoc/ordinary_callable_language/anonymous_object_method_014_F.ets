import { taint } from "./taint_mock";

export function anonymous_object_method_014_F(taint_src: string): void {
  const holder = {
    run(_data: string): void {
      taint.Sink("clean");
    },
  };

  const fp = holder.run;
  fp(taint_src);
}
