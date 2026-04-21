import { taint } from "./taint_mock";

function target(data: string): void {
  taint.Sink(data);
}

export function reflect_call_001_T(taint_src: string) {
  Reflect.call(target, undefined, taint_src);
}
