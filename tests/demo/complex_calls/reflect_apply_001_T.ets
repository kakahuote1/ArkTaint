import { taint } from "./taint_mock";

function target(data: string): void {
  taint.Sink(data);
}

export function reflect_apply_001_T(taint_src: string) {
  Reflect.apply(target, undefined, [taint_src]);
}
