import { taint } from "./taint_mock";

export function path_gate_002_F(taint_src: string) {
  let res = "";
  if (1 > 2) {
    res = taint_src;
  } else {
    res = "_";
  }
  taint.Sink(res);
}
