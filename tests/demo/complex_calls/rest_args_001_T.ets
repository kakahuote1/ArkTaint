import { taint } from "./taint_mock";

function sinkRest(...args: string[]): void {
  taint.Sink(args[0]);
}

export function rest_args_001_T(taint_src: string) {
  sinkRest(taint_src, "_");
}
