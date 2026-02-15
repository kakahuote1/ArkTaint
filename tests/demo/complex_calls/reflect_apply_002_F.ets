import { taint } from "./taint_mock";

function target(data: string): void {
  taint.Sink(data);
}

export function reflect_apply_002_F(taint_src: string) {
  let clean = "_";
  Reflect.apply(target, undefined, [clean]);
}
