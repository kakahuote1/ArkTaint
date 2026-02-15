import { taint } from "./taint_mock";

function sinkRest(...args: string[]): void {
  taint.Sink(args[0]);
}

export function rest_args_002_F(taint_src: string) {
  sinkRest("_", "_");
}
