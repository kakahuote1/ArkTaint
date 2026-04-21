import { taint } from "./taint_mock";

export function anonymous_object_method_013_T(taint_src: string): void {
  const holder = {
    run(data: string): void {
      taint.Sink(data);
    },
  };

  const fp = holder.run;
  fp(taint_src);
}
