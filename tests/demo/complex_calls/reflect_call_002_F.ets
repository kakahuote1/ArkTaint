import { taint } from "./taint_mock";

function target(data: string): void {
  taint.Sink(data);
}

export function reflect_call_002_F(taint_src: string) {
  let clean = "_";
  Reflect.call(target, undefined, clean);
}
